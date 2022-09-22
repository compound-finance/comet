import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal, wait } from '../../../../src/deploy';

import { expect } from 'chai';

const clone = {
  link: '0x514910771af9ca656af840dff83e8264ecf986ca',
};

const LINK_PRICE_FEED = '0x48731cF7e84dc94C5f84577882c14Be11a5B7456';

export default migration('1663870047_add_link', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();
    const signer = await deploymentManager.getSigner();

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      fauceteer,
    } = await deploymentManager.getContracts();

    // Clone LINK and send half of total supply to the fauceteer
    const LINK = await deploymentManager.clone('LINK', clone.link, []);
    trace(`Sending half of all LINK to fauceteer`);
    const amount = (await LINK.balanceOf(signer.address)).div(2);
    trace(await wait(LINK.connect(signer).transfer(fauceteer.address, amount)));
    trace(`LINK.balanceOf(${fauceteer.address}): ${await LINK.balanceOf(fauceteer.address)}`);

    const linkAssetConfig = {
      asset: LINK.address,
      priceFeed: LINK_PRICE_FEED,
      decimals: await LINK.decimals(),
      borrowCollateralFactor: exp(0.75, 18),
      liquidateCollateralFactor: exp(0.8, 18),
      liquidationFactor: exp(0.92, 18),
      supplyCap: exp(50_000_000, 18),
    };

    const actions = [
      // 1. Add LINK in Configurator
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, linkAssetConfig],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];
    const description = "# Add LINK to Goerli";
    const txn = await deploymentManager.retry(
      async () => governor.propose(...await proposal(actions, description))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      fauceteer,
      LINK
    } = await deploymentManager.getContracts();

    // 1.
    const linkAssetConfig = {
      offset: 3,
      asset: LINK.address,
      priceFeed: LINK_PRICE_FEED,
      scale: exp(1, await LINK.decimals()),
      borrowCollateralFactor: exp(0.75, 18),
      liquidateCollateralFactor: exp(0.8, 18),
      liquidationFactor: exp(0.92, 18),
      supplyCap: exp(50_000_000, 18),
    };

    expect(await comet.getAssetInfoByAddress(LINK.address)).to.be.equal(linkAssetConfig);

    // XXX check configurator state as well

    // 2.
    expect(await LINK.balanceOf(fauceteer.address)).to.be.equal(exp(500_000_000, 18)); // Half of 1bn total supply
  },
});
