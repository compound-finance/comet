import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const USDM_TO_USD_PRICE_FEED_ADDRESS = '0x24EA2671671c33D66e9854eC06e42E5D3ac1f764';

let newWUSDMPriceFeedAddress: string;

export default migration('1740958662_change_price_feeds_for_4626_collaterals', {
  async prepare(deploymentManager: DeploymentManager) {
    const { comet } = await deploymentManager.getContracts();
    const currentBlock = await deploymentManager.hre.ethers.provider.getBlockNumber();
    const currentBlockTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(currentBlock)).timestamp;
    const _wUSDMPriceFeed = await deploymentManager.deploy(
      'wUSDM:priceFeed',
      'pricefeeds/ERC4626CorrelatedAssetsPriceOracle.sol',
      [
        {
          manager: await comet.pauseGuardian(),
          baseAggregatorAddress: USDM_TO_USD_PRICE_FEED_ADDRESS,
          ratioProviderAddress: WUSDM_ADDRESS,
          description: 'wUSDM / USD price feed',
          ratioDecimals: 18,
          priceFeedDecimals: 8,
          minimumSnapshotDelay: 3600,
          priceCapParams: {
            snapshotRatio: exp(1, 18),
            snapshotTimestamp: currentBlockTimestamp - 3600,
            maxYearlyRatioGrowthPercent: exp(10, 4),
          }
        }
      ],
      true
    );

    return {
      wUSDMPriceFeedAddress: _wUSDMPriceFeed.address,
    };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    wUSDMPriceFeedAddress,
  }) => {
    const trace = deploymentManager.tracer();

    newWUSDMPriceFeedAddress = wUSDMPriceFeedAddress;

    const {
      comet,
      cometAdmin,
      configurator,
      bridgeReceiver,
      timelock: l2Timelock,
    } = await deploymentManager.getContracts();

    const {
      governor,
      arbitrumInbox,
      timelock
    } = await govDeploymentManager.getContracts();

    const updateUSDCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(comet.address, WUSDM_ADDRESS, wUSDMPriceFeedAddress)
    );

    const deployAndUpgradeToUSDCCalldata = await calldata(
      cometAdmin.populateTransaction.deployAndUpgradeTo(configurator.address, comet.address)
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address
        ],
        [
          0, 0
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateUSDCPriceFeedCalldata,
          deployAndUpgradeToUSDCCalldata
        ],
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
      // 1. Sends the proposal to the L2
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

    const description = 'DESCRIPTION';
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    // 1. Compare current wUSDM price feed address with new price feed address
    const wUSDMAssetInfo = await comet.getAssetInfoByAddress(WUSDM_ADDRESS);
    expect(newWUSDMPriceFeedAddress).to.be.equal(wUSDMAssetInfo.priceFeed);
    const wUSDMAssetIndex = wUSDMAssetInfo.offset;
    const configuratorWUSDMAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wUSDMAssetIndex];
    expect(newWUSDMPriceFeedAddress).to.be.equal(configuratorWUSDMAssetConfig.priceFeed);
  },
});
