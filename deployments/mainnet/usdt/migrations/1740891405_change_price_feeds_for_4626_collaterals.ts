import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { Contract } from 'ethers';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const WUSDM_TO_USDM_PRICE_FEED_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const USDM_TO_USD_PRICE_FEED_ADDRESS = '0x079674468Fee6ab45aBfE986737A440701c49BdB';

const SFRAX_ADDRESS = '0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32';
const SFRAX_TO_FRAX_PRICE_FEED_ADDRESS = '0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32';
const FRAX_TO_USD_PRICE_FEED_ADDRESS = '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD';

const SUSDS_ADDRESS = '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD';
const USDS_TO_USD_PRICE_FEED_ADDRESS = '0xfF30586cD0F29eD462364C7e81375FC0C71219b1';

let newWUSDMPriceFeedAddress: string;
let newSFRAXPriceFeedAddress: string;
let newSUSDSPriceFeedAddress: string;

const USDS_COMET_ADDRESS = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';

export default migration('1740891405_change_price_feeds_for_4626_collaterals', {
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
          ratioProviderAddress: WUSDM_TO_USDM_PRICE_FEED_ADDRESS,
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

    const _sFRAXPriceFeed = await deploymentManager.deploy(
      'sFRAX:priceFeed',
      'pricefeeds/ERC4626CorrelatedAssetsPriceOracle.sol',
      [
        {
          manager: await comet.pauseGuardian(),
          baseAggregatorAddress: FRAX_TO_USD_PRICE_FEED_ADDRESS,
          ratioProviderAddress: SFRAX_TO_FRAX_PRICE_FEED_ADDRESS,
          description: 'sFRAX / USD price feed',
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

    const _sUSDSPriceFeed = await deploymentManager.deploy(
      'sUSDS:priceFeed',
      'pricefeeds/ERC4626CorrelatedAssetsPriceOracle.sol',
      [
        {
          manager: await comet.pauseGuardian(),
          baseAggregatorAddress: USDS_TO_USD_PRICE_FEED_ADDRESS,
          ratioProviderAddress: SUSDS_ADDRESS,
          description: 'sUSDS / USD price feed',
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
      sFRAXPriceFeedAddress: _sFRAXPriceFeed.address,
      sUSDSPriceFeedAddress: _sUSDSPriceFeed.address,
    };
  },

  enact: async (deploymentManager: DeploymentManager, _, {
    wUSDMPriceFeedAddress,
    sFRAXPriceFeedAddress,
    sUSDSPriceFeedAddress,
  }) => {
    const trace = deploymentManager.tracer();

    newWUSDMPriceFeedAddress = wUSDMPriceFeedAddress;
    newSFRAXPriceFeedAddress = sFRAXPriceFeedAddress;
    newSUSDSPriceFeedAddress = sUSDSPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Upgrade wUSDM asset price feed on cUSDTv3
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WUSDM_ADDRESS, wUSDMPriceFeedAddress],
      },
      // 2. Upgrade sFRAX asset price feed on cUSDTv3
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, SFRAX_ADDRESS, sFRAXPriceFeedAddress],
      },
      // 3. Update sUSDS price feed on cUSDSv3
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [USDS_COMET_ADDRESS, SUSDS_ADDRESS, newSUSDSPriceFeedAddress],
      },
      // 4. Deploy and upgrade to a new version cUSDTv3
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
      // 5. Deploy and upgrade to a new version cUSDSv3
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDS_COMET_ADDRESS],
      }
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

    // 2. Compare current sFRAX price feed address with new price feed address
    const sFRAXAssetInfo = await comet.getAssetInfoByAddress(SFRAX_ADDRESS);
    expect(newSFRAXPriceFeedAddress).to.be.equal(sFRAXAssetInfo.priceFeed);
    const sFRAXAssetIndex = sFRAXAssetInfo.offset;
    const configuratorSFRAXAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[sFRAXAssetIndex];
    expect(newSFRAXPriceFeedAddress).to.be.equal(configuratorSFRAXAssetConfig.priceFeed);

    // 3. Compare current sUSDS price feed address with new price feed address
    const usdsComet = new Contract(USDS_COMET_ADDRESS, comet.interface, await deploymentManager.getSigner());
    const sUSDSAssetInfo = await usdsComet.getAssetInfoByAddress(SUSDS_ADDRESS);
    expect(newSUSDSPriceFeedAddress).to.be.equal(sUSDSAssetInfo.priceFeed);
    const sUSDSAssetIndex = sUSDSAssetInfo.offset;
    const configuratorSUSDSAssetConfig = (await configurator.getConfiguration(usdsComet.address)).assetConfigs[sUSDSAssetIndex];
    expect(newSUSDSPriceFeedAddress).to.be.equal(configuratorSUSDSAssetConfig.priceFeed);
  },
});
