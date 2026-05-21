import { Contract } from 'ethers';
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
    const description = `# Update rETH price feed in cWETHv3 on Mainnet

## Proposal summary

This proposal updates the rETH price feed in the Compound III WETH market on Ethereum.

Due to the deprecation of the RETH / ETH Chainlink Oracle, the rETH price feed must be replaced with a new CAPO price feed that fetches the rETH / ETH exchange rate directly from the rETH contract. The new price feed retains the same CAPO parameters as the previous one.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1097) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

### New price feed audit

New CAPO price feed for rETH has been audited by [Certora](https://www.certora.com/reports/compound-reth-capo) and no issues were found.

## Proposal Actions

The first action updates the rETH price feed to the new CAPO contract.

The second action deploys and upgrades Comet to a new version.`;

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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
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

    const rETHPriceFeed = (await comet.getAssetInfoByAddress(rETH.address)).priceFeed;
    expect(rETHPriceFeed).to.equal(newRETHPriceFeed);

    const newPriceFeedContract = new Contract(
      newRETHPriceFeed,
      ['function maxYearlyRatioGrowthPercent() view returns (uint32)'],
      await deploymentManager.getSigner()
    );

    expect(await newPriceFeedContract.maxYearlyRatioGrowthPercent()).to.equal(290);
  },
});
