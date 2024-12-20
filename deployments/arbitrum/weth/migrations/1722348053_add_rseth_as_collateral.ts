import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const RSETH_ADDRESS = '0x4186BFC76E2E237523CBC30FD220FE055156b41F';
const RSETH_ETH_PRICE_FEED_ADDRESS = '0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1';

export default migration('1722348053_add_rseth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _rsETHScalingPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        RSETH_ETH_PRICE_FEED_ADDRESS, // rsETH / ETH price feed
        8                             // decimals
      ]
    );
    return { rsETHScalingPriceFeed: _rsETHScalingPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { rsETHScalingPriceFeed }) => {
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

    const rsETH = await deploymentManager.existing(
      'rsETH',
      RSETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const rsETHPricefeed = await deploymentManager.existing(
      'rsETH:priceFeed',
      rsETHScalingPriceFeed,
      'arbitrum'
    );

    const rsETHAssetConfig = {
      asset: rsETH.address,
      priceFeed: rsETHPricefeed.address,
      decimals: 18n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(920, 18), 
    };

    const addAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          rsETHAssetConfig.asset,
          rsETHAssetConfig.priceFeed,
          rsETHAssetConfig.decimals,
          rsETHAssetConfig.borrowCollateralFactor,
          rsETHAssetConfig.liquidateCollateralFactor,
          rsETHAssetConfig.liquidationFactor,
          rsETHAssetConfig.supplyCap
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

    const description = '# Add rsETH as collateral into cWETHv3 on Arbitrum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add rsETH into cWETHv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-rseth-as-collateral-on-arbitrum-and-wrseth-as-collateral-on-optimism-base-and-scroll/5445/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/896) and [forum discussion](https://www.comp.xyz/t/add-rseth-as-collateral-on-arbitrum-and-wrseth-as-collateral-on-optimism-base-and-scroll/5445).\n\n## Price FeedFor LRT/LSTs we use exchange rate price feeds. We are going to use this exchange rate [price feed](https://arbiscan.io/address/0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1#readContract) by Chainlink. It has the wrong description `wrsETH / rsETH Exchange Rate`. However, we were assured, that it is the right price feed by the Chainlink team. \n\n\n## Proposal Actions\n\nThe first proposal action adds rsETH to the WETH Comet on Arbitrum. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return true;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const rsETHAssetIndex = Number(await comet.numAssets()) - 1;

    const rsETH = await deploymentManager.existing(
      'rsETH',
      RSETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const rsETHAssetConfig = {
      asset: rsETH.address,
      priceFeed: '',
      decimals: 18n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(920, 18),
    };

    // 1. & 2. Compare rsETH asset config with Comet and Configurator asset info
    const cometRsETHHAssetInfo = await comet.getAssetInfoByAddress(
      RSETH_ADDRESS
    );
    expect(rsETHAssetIndex).to.be.equal(cometRsETHHAssetInfo.offset);
    expect(rsETHAssetConfig.asset).to.be.equal(cometRsETHHAssetInfo.asset);
    expect(exp(1, rsETHAssetConfig.decimals)).to.be.equal(cometRsETHHAssetInfo.scale);
    expect(rsETHAssetConfig.borrowCollateralFactor).to.be.equal(cometRsETHHAssetInfo.borrowCollateralFactor);
    expect(rsETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometRsETHHAssetInfo.liquidateCollateralFactor);
    expect(rsETHAssetConfig.liquidationFactor).to.be.equal(cometRsETHHAssetInfo.liquidationFactor);
    expect(rsETHAssetConfig.supplyCap).to.be.equal(cometRsETHHAssetInfo.supplyCap);

    const configuratorRsETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[rsETHAssetIndex];
    expect(rsETHAssetConfig.asset).to.be.equal(configuratorRsETHAssetConfig.asset);
    expect(rsETHAssetConfig.decimals).to.be.equal(configuratorRsETHAssetConfig.decimals);
    expect(rsETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorRsETHAssetConfig.borrowCollateralFactor);
    expect(rsETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorRsETHAssetConfig.liquidateCollateralFactor);
    expect(rsETHAssetConfig.liquidationFactor).to.be.equal(configuratorRsETHAssetConfig.liquidationFactor);
    expect(rsETHAssetConfig.supplyCap).to.be.equal(configuratorRsETHAssetConfig.supplyCap);
  },
});
