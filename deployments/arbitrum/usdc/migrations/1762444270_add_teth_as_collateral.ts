import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const USDT_COMET_ADDRESS = '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07';
const WETH_COMET_ADDRESS = '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486';

const TETH_ADDRESS = '0xd09ACb80C1E8f2291862c4978A008791c9167003';

const TETH_TO_WSTETH_PRICE_FEED_ADDRESS = '0x98a977Ba31C72aeF2e15B950Eb5Ae3158863D856';
const WSTETH_TO_ETH_PRICE_FEED_ADDRESS = '0x311930889C61E141E15a61D11BE974D749390E7A';
const WSTETH_TO_USD_PRICE_FEED_ADDRESS = '0x92014e7f331dFaB2848A5872AA8b2E7b6f3cE8B4';

let newPriceFeedToUSD: string;
let newPriceFeedToETH: string;

export default migration('1762444270_add_teth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _tETHPriceFeedToUSD = await deploymentManager.deploy(
      'tETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        TETH_TO_WSTETH_PRICE_FEED_ADDRESS,  // tETH / ETH price feed
        WSTETH_TO_USD_PRICE_FEED_ADDRESS,    // ETH / USD price feed
        8,                                // decimals
        'tETH / USD price feed'          // description
      ]
    );

    const _tETHPriceFeedToETH = await deploymentManager.deploy(
      'tETH:priceFeedToETH',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        TETH_TO_WSTETH_PRICE_FEED_ADDRESS,  // tETH / ETH price feed
        WSTETH_TO_ETH_PRICE_FEED_ADDRESS,    // ETH / USD price feed
        8,                                // decimals
        'tETH / ETH price feed'          // description
      ]
    );

    return {
      tETHPriceFeedToUSDAddress: _tETHPriceFeedToUSD.address,
      tETHPriceFeedToETHAddress: _tETHPriceFeedToETH.address
    };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    tETHPriceFeedToUSDAddress,
    tETHPriceFeedToETHAddress
  }) => {
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

    newPriceFeedToUSD = tETHPriceFeedToUSDAddress;
    newPriceFeedToETH = tETHPriceFeedToETHAddress;

    const tETH = await deploymentManager.existing(
      'tETH',
      TETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const tETHPriceFeedToUSD = await deploymentManager.existing(
      'tETH:priceFeed',
      tETHPriceFeedToUSDAddress,
      'arbitrum'
    );

    const tETHPriceFeedToETH = await deploymentManager.existing(
      'tETH:priceFeedToETH',
      tETHPriceFeedToETHAddress,
      'arbitrum'
    );

    const tETHAssetConfigToUSD = {
      asset: tETH.address,
      priceFeed: tETHPriceFeedToUSD.address,
      decimals: 18n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(50, 18),
    };

    const tETHAssetConfigToETH = {
      asset: tETH.address,
      priceFeed: tETHPriceFeedToETH.address,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(50, 18),
    };

    const addAssetCalldataToUSDC = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [
        comet.address,
        [
          tETHAssetConfigToUSD.asset,
          tETHAssetConfigToUSD.priceFeed,
          tETHAssetConfigToUSD.decimals,
          tETHAssetConfigToUSD.borrowCollateralFactor,
          tETHAssetConfigToUSD.liquidateCollateralFactor,
          tETHAssetConfigToUSD.liquidationFactor,
          tETHAssetConfigToUSD.supplyCap
        ]
      ]
    );

    const addAssetCalldataToUSDT = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [
        USDT_COMET_ADDRESS,
        [
          tETHAssetConfigToUSD.asset,
          tETHAssetConfigToUSD.priceFeed,
          tETHAssetConfigToUSD.decimals,
          tETHAssetConfigToUSD.borrowCollateralFactor,
          tETHAssetConfigToUSD.liquidateCollateralFactor,
          tETHAssetConfigToUSD.liquidationFactor,
          tETHAssetConfigToUSD.supplyCap
        ]
      ]
    );

    const addAssetCalldataToWETH = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [
        WETH_COMET_ADDRESS,
        [
          tETHAssetConfigToETH.asset,
          tETHAssetConfigToETH.priceFeed,
          tETHAssetConfigToETH.decimals,
          tETHAssetConfigToETH.borrowCollateralFactor,
          tETHAssetConfigToETH.liquidateCollateralFactor,
          tETHAssetConfigToETH.liquidationFactor,
          tETHAssetConfigToETH.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToCalldataUSDC = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const deployAndUpgradeToCalldataUSDT = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDT_COMET_ADDRESS]
    );

    const deployAndUpgradeToCalldataWETH = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, WETH_COMET_ADDRESS]
    );
    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address,
          configurator.address,
          cometAdmin.address,
          configurator.address,
          cometAdmin.address,
        ],
        [
          0,
          0,
          0,
          0,
          0,
          0,
        ],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          addAssetCalldataToUSDC,
          deployAndUpgradeToCalldataUSDC,
          addAssetCalldataToUSDT,
          deployAndUpgradeToCalldataUSDT,
          addAssetCalldataToWETH,
          deployAndUpgradeToCalldataWETH,
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
      // 1. Set Comet configuration and deployAndUpgradeTo USDC Comet on Arbitrum.
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

    const description = `# Add tETH as collaterals into cUSDCv3, cUSDTv3 and cWETHv3 on Arbitrum

## Proposal summary

WOOF proposes to add tETH into cUSDCv3, cUSDTv3 and cWETHv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III wstETH market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/listing-teth-arbitrum-as-collateral-for-compound-arbitrum/7299/2).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1059) and [forum discussion](https://www.comp.xyz/t/listing-teth-arbitrum-as-collateral-for-compound-arbitrum/7299).


## Proposal Actions

The first proposal action adds tETH to the USDC, USDT and WETH comets on Arbitrum. This sends the encoded 'addAsset' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.`;

    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description)))), 0, 300_000
    );

    const event = txn.events.find((event: { event: string }) => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const tETH = await deploymentManager.existing(
      'tETH',
      TETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const tETHAssetConfigToUSD = {
      asset: tETH.address,
      priceFeed: newPriceFeedToUSD,
      decimals: 18n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(50, 18),
    };

    // 1. USDC Comet
    const tETHAssetIndexUSDC = Number(await comet.numAssets()) - 1;
    const cometTETHAssetInfoUSDC = await comet.getAssetInfoByAddress(TETH_ADDRESS);
    expect(tETHAssetIndexUSDC).to.be.equal(cometTETHAssetInfoUSDC.offset);
    expect(tETHAssetConfigToUSD.asset).to.be.equal(cometTETHAssetInfoUSDC.asset);
    expect(exp(1, tETHAssetConfigToUSD.decimals)).to.be.equal(cometTETHAssetInfoUSDC.scale);
    expect(tETHAssetConfigToUSD.borrowCollateralFactor).to.be.equal(cometTETHAssetInfoUSDC.borrowCollateralFactor);
    expect(tETHAssetConfigToUSD.liquidateCollateralFactor).to.be.equal(cometTETHAssetInfoUSDC.liquidateCollateralFactor);
    expect(tETHAssetConfigToUSD.liquidationFactor).to.be.equal(cometTETHAssetInfoUSDC.liquidationFactor);
    expect(tETHAssetConfigToUSD.supplyCap).to.be.equal(cometTETHAssetInfoUSDC.supplyCap);

    const configuratorTETHAssetConfigUSDC = (await configurator.getConfiguration(comet.address)).assetConfigs[tETHAssetIndexUSDC];
    expect(tETHAssetConfigToUSD.asset).to.be.equal(configuratorTETHAssetConfigUSDC.asset);
    expect(tETHAssetConfigToUSD.decimals).to.be.equal(configuratorTETHAssetConfigUSDC.decimals);
    expect(tETHAssetConfigToUSD.borrowCollateralFactor).to.be.equal(configuratorTETHAssetConfigUSDC.borrowCollateralFactor);
    expect(tETHAssetConfigToUSD.liquidateCollateralFactor).to.be.equal(configuratorTETHAssetConfigUSDC.liquidateCollateralFactor);
    expect(tETHAssetConfigToUSD.liquidationFactor).to.be.equal(configuratorTETHAssetConfigUSDC.liquidationFactor);
    expect(tETHAssetConfigToUSD.supplyCap).to.be.equal(configuratorTETHAssetConfigUSDC.supplyCap);

    // 2. USDT Comet
    const cometUSDT = new ethers.Contract(
      USDT_COMET_ADDRESS,
      comet.interface,
      await deploymentManager.getSigner()
    );
    const tETHAssetIndexUSDT = Number(await cometUSDT.numAssets()) - 1;
    const cometTETHAssetInfoUSDT = await cometUSDT.getAssetInfoByAddress(TETH_ADDRESS);
    expect(tETHAssetIndexUSDT).to.be.equal(cometTETHAssetInfoUSDT.offset);
    expect(tETHAssetConfigToUSD.asset).to.be.equal(cometTETHAssetInfoUSDT.asset);
    expect(exp(1, tETHAssetConfigToUSD.decimals)).to.be.equal(cometTETHAssetInfoUSDT.scale);
    expect(tETHAssetConfigToUSD.borrowCollateralFactor).to.be.equal(cometTETHAssetInfoUSDT.borrowCollateralFactor);
    expect(tETHAssetConfigToUSD.liquidateCollateralFactor).to.be.equal(cometTETHAssetInfoUSDT.liquidateCollateralFactor);
    expect(tETHAssetConfigToUSD.liquidationFactor).to.be.equal(cometTETHAssetInfoUSDT.liquidationFactor);
    expect(tETHAssetConfigToUSD.supplyCap).to.be.equal(cometTETHAssetInfoUSDT.supplyCap);

    const configuratorTETHAssetConfigUSDT = (await configurator.getConfiguration(cometUSDT.address)).assetConfigs[tETHAssetIndexUSDT];
    expect(tETHAssetConfigToUSD.asset).to.be.equal(configuratorTETHAssetConfigUSDT.asset);
    expect(tETHAssetConfigToUSD.decimals).to.be.equal(configuratorTETHAssetConfigUSDT.decimals);
    expect(tETHAssetConfigToUSD.borrowCollateralFactor).to.be.equal(configuratorTETHAssetConfigUSDT.borrowCollateralFactor);
    expect(tETHAssetConfigToUSD.liquidateCollateralFactor).to.be.equal(configuratorTETHAssetConfigUSDT.liquidateCollateralFactor);
    expect(tETHAssetConfigToUSD.liquidationFactor).to.be.equal(configuratorTETHAssetConfigUSDT.liquidationFactor);
    expect(tETHAssetConfigToUSD.supplyCap).to.be.equal(configuratorTETHAssetConfigUSDT.supplyCap);

    // 3. WETH Comet
    const tETHAssetConfigToETH = {
      asset: tETH.address,
      priceFeed: newPriceFeedToETH,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(50, 18),
    };

    const cometWETH = new ethers.Contract(
      WETH_COMET_ADDRESS,
      comet.interface,
      await deploymentManager.getSigner()
    );

    const tETHAssetIndexWETH = Number(await cometWETH.numAssets()) - 1;
    const cometTETHAssetInfoWETH = await cometWETH.getAssetInfoByAddress(TETH_ADDRESS);
    expect(tETHAssetIndexWETH).to.be.equal(cometTETHAssetInfoWETH.offset);
    expect(tETHAssetConfigToETH.asset).to.be.equal(cometTETHAssetInfoWETH.asset);
    expect(exp(1, tETHAssetConfigToETH.decimals)).to.be.equal(cometTETHAssetInfoWETH.scale);
    expect(tETHAssetConfigToETH.borrowCollateralFactor).to.be.equal(cometTETHAssetInfoWETH.borrowCollateralFactor);
    expect(tETHAssetConfigToETH.liquidateCollateralFactor).to.be.equal(cometTETHAssetInfoWETH.liquidateCollateralFactor);
    expect(tETHAssetConfigToETH.liquidationFactor).to.be.equal(cometTETHAssetInfoWETH.liquidationFactor);
    expect(tETHAssetConfigToETH.supplyCap).to.be.equal(cometTETHAssetInfoWETH.supplyCap);

    const configuratorTETHAssetConfigWETH = (await configurator.getConfiguration(cometWETH.address)).assetConfigs[tETHAssetIndexWETH];
    expect(tETHAssetConfigToETH.asset).to.be.equal(configuratorTETHAssetConfigWETH.asset);
    expect(tETHAssetConfigToETH.decimals).to.be.equal(configuratorTETHAssetConfigWETH.decimals);
    expect(tETHAssetConfigToETH.borrowCollateralFactor).to.be.equal(configuratorTETHAssetConfigWETH.borrowCollateralFactor);
    expect(tETHAssetConfigToETH.liquidateCollateralFactor).to.be.equal(configuratorTETHAssetConfigWETH.liquidateCollateralFactor);
    expect(tETHAssetConfigToETH.liquidationFactor).to.be.equal(configuratorTETHAssetConfigWETH.liquidationFactor);
    expect(tETHAssetConfigToETH.supplyCap).to.be.equal(configuratorTETHAssetConfigWETH.supplyCap);
  },
});
