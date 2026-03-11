import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { proposal, exp } from '../../../../src/deploy';

import { expect } from 'chai';

let newRETHPriceFeed: string;
let oldRETHPriceFeed: string;

const FEED_DECIMALS = 8;
const blockToFetch = 24000000;

export default migration('1773227248_update_reth_pricefeed', {
  async prepare(deploymentManager: DeploymentManager) {
    const {
      rETH,
      timelock,
      'WETH:priceFeed' : constantPriceFeed,
    } = await deploymentManager.getContracts();
    const blockToFetchTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))!.timestamp;

    const currentRatioRETH = await rETH.getExchangeRate({blockTag: blockToFetch});
    const rEthCapoPriceFeed = await deploymentManager.deploy(
      'rETH:priceFeed',
      'capo/contracts/RETHCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        rETH.address,
        'rETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRETH,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0290, 4)
        }
      ],
      true
    );
    return { rETHPriceFeed: rEthCapoPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { rETHPriceFeed }) {
    const trace = deploymentManager.tracer();

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rETH
    } = await deploymentManager.getContracts();

    [,, oldRETHPriceFeed] = await comet.getAssetInfoByAddress(rETH.address);

    newRETHPriceFeed = rETHPriceFeed;
    const mainnetActions = [
      // 1. Update the price feed for rETH
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, rETH.address, rETHPriceFeed],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];
    const description = '\n\n\n\nDESCRIPTION\n\n\n\n';
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      configurator,
      rETH
    } = await deploymentManager.getContracts();

    const rETHId = await configurator.getAssetIndex(comet.address, rETH.address);
    const configuration = await configurator.getConfiguration(comet.address);
    expect(configuration.assetConfigs[rETHId].priceFeed).to.eq(newRETHPriceFeed);
    expect((await comet.getAssetInfoByAddress(rETH.address)).priceFeed).to.equal(newRETHPriceFeed);
    expect(oldRETHPriceFeed).to.not.equal(newRETHPriceFeed);
    expect(await comet.getPrice(newRETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldRETHPriceFeed), exp(0.01, 8));  

  },
});
