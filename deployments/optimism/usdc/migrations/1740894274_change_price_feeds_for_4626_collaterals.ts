import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { Contract, utils } from 'ethers';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const USDM_USD_PRICE_FEED_ADDRESS = '0xA45881b63ff9BE3F9a3439CA0c002686e65a8ED5';let newWUSDMPriceFeedAddress: string;

const USDT_COMET_ADDRESS = '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214';

export default migration('1740894274_change_price_feeds_for_4626_collaterals', {
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
          baseAggregatorAddress: USDM_USD_PRICE_FEED_ADDRESS,
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
      bridgeReceiver
    } = await deploymentManager.getContracts();

    const { governor, opL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const updateUSDCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(comet.address, WUSDM_ADDRESS, wUSDMPriceFeedAddress)
    );

    const updateUSDTPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(USDT_COMET_ADDRESS, WUSDM_ADDRESS, wUSDMPriceFeedAddress)
    );

    const deployAndUpgradeToUSDCCalldata = await calldata(
      cometAdmin.populateTransaction.deployAndUpgradeTo(configurator.address, comet.address)
    );

    const deployAndUpgradeToUSDTCalldata = await calldata(
      cometAdmin.populateTransaction.deployAndUpgradeTo(configurator.address, USDT_COMET_ADDRESS)
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, configurator.address,
          cometAdmin.address, cometAdmin.address
        ],
        [
          0, 0,
          0, 0
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateUSDCPriceFeedCalldata, updateUSDTPriceFeedCalldata,
          deployAndUpgradeToUSDCCalldata, deployAndUpgradeToUSDTCalldata
        ],
      ]
    );

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
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


    // 2. Compare current sUSDS price feed address with new price feed address
    const usdTComet = new Contract(USDT_COMET_ADDRESS, comet.interface, await deploymentManager.getSigner());
    const wUSDMAssetInfoUSDT = await usdTComet.getAssetInfoByAddress(WUSDM_ADDRESS);
    expect(newWUSDMPriceFeedAddress).to.be.equal(wUSDMAssetInfoUSDT.priceFeed);
    const wUSDMAssetIndexUSDT = wUSDMAssetInfo.offset;
    const configuratorWUSDMAssetConfigUSDT = (await configurator.getConfiguration(comet.address)).assetConfigs[wUSDMAssetIndexUSDT];
    expect(newWUSDMPriceFeedAddress).to.be.equal(configuratorWUSDMAssetConfigUSDT.priceFeed);
  },
});
