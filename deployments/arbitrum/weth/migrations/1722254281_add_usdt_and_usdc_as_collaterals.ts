import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const USDT_USD_PRICE_FEED_ADDRESS = '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7';

const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDC_USD_PRICE_FEED_ADDRESS = '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3';

const ETH_USD_PRICE_FEED_ADDRESS = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';

export default migration('1722254281_add_usdt_and_usdc_as_collaterals', {
  async prepare(deploymentManager: DeploymentManager) {
    const _usdtPriceFeed = await deploymentManager.deploy(
      'USDT:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        USDT_USD_PRICE_FEED_ADDRESS,  // USDT / USD price feed
        ETH_USD_PRICE_FEED_ADDRESS,   // USD / ETH price feed 
        8,                            // decimals
        'USDT / USD  USD / ETH',      // description
      ]
    );

    const _usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        USDC_USD_PRICE_FEED_ADDRESS,  // USDC / USD price feed
        ETH_USD_PRICE_FEED_ADDRESS,   // USD / ETH price feed 
        8,                            // decimals
        'USDC / USD  USD / ETH',      // description
      ]
    );

    return { usdtPriceFeed: _usdtPriceFeed.address, usdcPriceFeed: _usdcPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { usdtPriceFeed, usdcPriceFeed }) => {
    const trace = deploymentManager.tracer();
    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const usdtPricefeed = await deploymentManager.existing(
      'USDT:priceFeed',
      usdtPriceFeed,
      'arbitrum'
    );

    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: usdtPricefeed.address,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(20_000_000, 6), 
    };

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const usdcPricefeed = await deploymentManager.existing(
      'USDC:priceFeed',
      usdcPriceFeed,
      'arbitrum'
    );

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: usdcPricefeed.address,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(30_000_000, 6),
    };

    const addUSDTAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          usdtAssetConfig.asset,
          usdtAssetConfig.priceFeed,
          usdtAssetConfig.decimals,
          usdtAssetConfig.borrowCollateralFactor,
          usdtAssetConfig.liquidateCollateralFactor,
          usdtAssetConfig.liquidationFactor,
          usdtAssetConfig.supplyCap
        ]
      ]
    );

    const addUSDCAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          usdcAssetConfig.asset,
          usdcAssetConfig.priceFeed,
          usdcAssetConfig.decimals,
          usdcAssetConfig.borrowCollateralFactor,
          usdcAssetConfig.liquidateCollateralFactor,
          usdcAssetConfig.liquidationFactor,
          usdcAssetConfig.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          cometAdmin.address
        ],
        [
          0,
          0,
          0
        ],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          addUSDTAssetCalldata,
          addUSDCAssetCalldata,
          deployAndUpgradeToCalldata,
        ]
      ]
    );

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );
    const refundAddress = l2Timelock.address;

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo WETH Comet on Arbitrum.
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
      },
    ];

    const description = '# Add USDT and USDC as collateral into cWETHv3 on Arbitrum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add USDT and USDC into cWETHv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/895) and [forum discussion](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415).\n\n\n## Proposal Actions\n\nThe first proposal action adds USDT and USDC to the WETH Comet on Arbitrum. This sends the encoded `addAsset` two times and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const usdtAssetIndex = Number(await comet.numAssets()) - 2;
    const usdcAssetIndex = Number(await comet.numAssets()) - 1;

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: '',
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(20_000_000, 6),
    };

    // 1. & 3. Compare USDT asset config with Comet and Configurator asset info
    const cometUSDTAssetInfo = await comet.getAssetInfoByAddress(
      USDT_ADDRESS
    );
    expect(usdtAssetIndex).to.be.equal(cometUSDTAssetInfo.offset);
    expect(usdtAssetConfig.asset).to.be.equal(cometUSDTAssetInfo.asset);
    expect(exp(1, usdtAssetConfig.decimals)).to.be.equal(cometUSDTAssetInfo.scale);
    expect(usdtAssetConfig.borrowCollateralFactor).to.be.equal(cometUSDTAssetInfo.borrowCollateralFactor);
    expect(usdtAssetConfig.liquidateCollateralFactor).to.be.equal(cometUSDTAssetInfo.liquidateCollateralFactor);
    expect(usdtAssetConfig.liquidationFactor).to.be.equal(cometUSDTAssetInfo.liquidationFactor);
    expect(usdtAssetConfig.supplyCap).to.be.equal(cometUSDTAssetInfo.supplyCap);

    const configuratorUSDTAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdtAssetIndex];
    expect(usdtAssetConfig.asset).to.be.equal(configuratorUSDTAssetConfig.asset);
    expect(usdtAssetConfig.decimals).to.be.equal(configuratorUSDTAssetConfig.decimals);
    expect(usdtAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUSDTAssetConfig.borrowCollateralFactor);
    expect(usdtAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUSDTAssetConfig.liquidateCollateralFactor);
    expect(usdtAssetConfig.liquidationFactor).to.be.equal(configuratorUSDTAssetConfig.liquidationFactor);
    expect(usdtAssetConfig.supplyCap).to.be.equal(configuratorUSDTAssetConfig.supplyCap);

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: '',
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(30_000_000, 6),
    };

    // 2. & 3. Compare USDC asset config with Comet and Configurator asset info
    const cometUSDCAssetInfo = await comet.getAssetInfoByAddress(
      USDC_ADDRESS
    );
    expect(usdcAssetIndex).to.be.equal(cometUSDCAssetInfo.offset);
    expect(usdcAssetConfig.asset).to.be.equal(cometUSDCAssetInfo.asset);
    expect(exp(1, usdcAssetConfig.decimals)).to.be.equal(cometUSDCAssetInfo.scale);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(cometUSDCAssetInfo.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(cometUSDCAssetInfo.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(cometUSDCAssetInfo.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(cometUSDCAssetInfo.supplyCap);

    const configuratorUSDCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdcAssetIndex];
    expect(usdcAssetConfig.asset).to.be.equal(configuratorUSDCAssetConfig.asset);
    expect(usdcAssetConfig.decimals).to.be.equal(configuratorUSDCAssetConfig.decimals);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUSDCAssetConfig.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUSDCAssetConfig.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(configuratorUSDCAssetConfig.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(configuratorUSDCAssetConfig.supplyCap);
  },
});
