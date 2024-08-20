import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';

const USDT_ADDRESS = '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58';
const USDT_USD_PRICE_FEED_ADDRESS = '0xECef79E109e997bCA29c1c0897ec9d7b03647F5E';

const USDC_ADDRESS = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85';
const USDC_USD_PRICE_FEED_ADDRESS = '0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3';

const ETH_USD_PRICE_FEED_ADDRESS = '0x13e3Ee699D1909E989722E753853AE30b17e08c5';

export default migration('1722506088_add_usdt_and_usdc_as_collaterals', {
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
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const {
      governor,
      opL1CrossDomainMessenger
    } = await govDeploymentManager.getContracts();

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );

    const usdtPricefeed = await deploymentManager.existing(
      'USDT:priceFeed',
      usdtPriceFeed,
      'optimism'
    );

    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: usdtPricefeed.address,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(10_000_000, 6), 
    };

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );

    const usdcPricefeed = await deploymentManager.existing(
      'USDC:priceFeed',
      usdcPriceFeed,
      'optimism'
    );

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: usdcPricefeed.address,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(15_000_000, 6),
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

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo WETH Comet on Optimism.
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000],
      },
    ];

    const description = '# Add USDT and USDC as collateral into cWETHv3 on Optimism\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add USDT and USDC into cWETHv3 on Optimism network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/900) and [forum discussion](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415).\n\n\n## Proposal Actions\n\nThe first proposal action adds USDT and USDC to the WETH Comet on Optimism. This sends the encoded `addAsset` two times and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism.';
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
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );

    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: '',
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(10_000_000, 6),
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
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: '',
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(15_000_000, 6),
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