import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const WBTC_ADDRESS = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';
const WBTC_BTC_PRICE_FEED_ADDRESS = '0x0017abAc5b6f291F9164e35B1234CA1D697f9CF4';
const BTC_ETH_PRICE_FEED_ADDRESS = '0xc5a90A6d7e4Af242dA238FFe279e9f2BA0c64B2e';

export default migration('1718791267_add_wbtc_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wbtcScalingPriceFeed = await deploymentManager.deploy(
      'WBTC:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WBTC_BTC_PRICE_FEED_ADDRESS,  // WBTC / BTC price feed
        BTC_ETH_PRICE_FEED_ADDRESS,   // BTC / ETH price feed 
        8,                            // decimals
        'WBTC / BTC  BTC / ETH',      // description
      ]
    );

    return { wbtcScalingPriceFeed: _wbtcScalingPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { wbtcScalingPriceFeed }) => {
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

    const WBTC = await deploymentManager.existing(
      'WBTC',
      WBTC_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const wbtcPricefeed = await deploymentManager.existing(
      'WBTC:priceFeed',
      wbtcScalingPriceFeed,
      'arbitrum'
    );

    const wbtcAssetConfig = {
      asset: WBTC.address,
      priceFeed: wbtcPricefeed.address,
      decimals: 8n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(300, 8), 
    };

    const addAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          wbtcAssetConfig.asset,
          wbtcAssetConfig.priceFeed,
          wbtcAssetConfig.decimals,
          wbtcAssetConfig.borrowCollateralFactor,
          wbtcAssetConfig.liquidateCollateralFactor,
          wbtcAssetConfig.liquidationFactor,
          wbtcAssetConfig.supplyCap
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
          cometAdmin.address
        ],
        [
          0,
          0
        ],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          addAssetCalldata,
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

    const description = '# Add WBTC as collateral into cWETHv3 on Arbitrum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add WBTC into cWETHv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet WBTC](https://www.comp.xyz/t/add-wbtc-to-weth-comets-on-ethereum-and-arbitrum/5332/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/880) and [forum discussion](https://www.comp.xyz/t/add-wbtc-to-weth-comets-on-ethereum-and-arbitrum/5332).\n\n\n## Proposal Actions\n\nThe first proposal action adds WBTC to the WETH Comet on Arbitrum. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum.';
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

    const wbtcAssetIndex = Number(await comet.numAssets()) - 1;

    const WBTC = await deploymentManager.existing(
      'WBTC',
      WBTC_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const wbtcAssetConfig = {
      asset: WBTC.address,
      priceFeed: '',
      decimals: 8n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(300, 8),
    };

    // 1. & 2. Compare WBTC asset config with Comet and Configurator asset info
    const cometWBTCHAssetInfo = await comet.getAssetInfoByAddress(
      WBTC_ADDRESS
    );
    expect(wbtcAssetIndex).to.be.equal(cometWBTCHAssetInfo.offset);
    expect(wbtcAssetConfig.asset).to.be.equal(cometWBTCHAssetInfo.asset);
    expect(exp(1, wbtcAssetConfig.decimals)).to.be.equal(
      cometWBTCHAssetInfo.scale
    );
    expect(wbtcAssetConfig.borrowCollateralFactor).to.be.equal(
      cometWBTCHAssetInfo.borrowCollateralFactor
    );
    expect(wbtcAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometWBTCHAssetInfo.liquidateCollateralFactor
    );
    expect(wbtcAssetConfig.liquidationFactor).to.be.equal(
      cometWBTCHAssetInfo.liquidationFactor
    );
    expect(wbtcAssetConfig.supplyCap).to.be.equal(
      cometWBTCHAssetInfo.supplyCap
    );
    const configuratorEsETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wbtcAssetIndex];
    expect(wbtcAssetConfig.asset).to.be.equal(
      configuratorEsETHAssetConfig.asset
    );
    expect(wbtcAssetConfig.decimals).to.be.equal(
      configuratorEsETHAssetConfig.decimals
    );
    expect(wbtcAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.borrowCollateralFactor
    );
    expect(wbtcAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidateCollateralFactor
    );
    expect(wbtcAssetConfig.liquidationFactor).to.be.equal(
      configuratorEsETHAssetConfig.liquidationFactor
    );
    expect(wbtcAssetConfig.supplyCap).to.be.equal(
      configuratorEsETHAssetConfig.supplyCap
    );
  },
});
