import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, proposal, wait } from '../../../../src/deploy';

import { expect } from 'chai';

const clone = {
  link: '0x514910771af9ca656af840dff83e8264ecf986ca',
};

const LINK_PRICE_FEED = '0x48731cF7e84dc94C5f84577882c14Be11a5B7456';
const PROPOSED_LINK_ASSET_INFO = {
  priceFeed: LINK_PRICE_FEED,
  decimals: 18,
  borrowCollateralFactor: exp(0.75, 18),
  liquidateCollateralFactor: exp(0.8, 18),
  liquidationFactor: exp(0.92, 18),
  supplyCap: exp(50_000_000, 18),
};

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
      ...PROPOSED_LINK_ASSET_INFO
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      configurator,
      fauceteer,
      LINK
    } = await deploymentManager.getContracts();
    const linkAssetIndex = 3;
    const linkAssetConfig = {
      asset: LINK.address,
      ...PROPOSED_LINK_ASSET_INFO
    };

    // 1. Compare proposed asset config with Comet asset info
    const cometLinkAssetInfo = await comet.getAssetInfoByAddress(LINK.address);
    expect(linkAssetIndex).to.be.equal(cometLinkAssetInfo.offset);
    expect(linkAssetConfig.asset).to.be.equal(cometLinkAssetInfo.asset);
    expect(linkAssetConfig.priceFeed).to.be.equal(cometLinkAssetInfo.priceFeed);
    expect(exp(1, linkAssetConfig.decimals)).to.be.equal(cometLinkAssetInfo.scale);
    expect(linkAssetConfig.borrowCollateralFactor).to.be.equal(cometLinkAssetInfo.borrowCollateralFactor);
    expect(linkAssetConfig.liquidateCollateralFactor).to.be.equal(cometLinkAssetInfo.liquidateCollateralFactor);
    expect(linkAssetConfig.liquidationFactor).to.be.equal(cometLinkAssetInfo.liquidationFactor);
    expect(linkAssetConfig.supplyCap).to.be.equal(cometLinkAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorLinkAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[linkAssetIndex];
    expect(linkAssetConfig.asset).to.be.equal(configuratorLinkAssetConfig.asset);
    expect(linkAssetConfig.priceFeed).to.be.equal(configuratorLinkAssetConfig.priceFeed);
    expect(linkAssetConfig.decimals).to.be.equal(configuratorLinkAssetConfig.decimals);
    expect(linkAssetConfig.borrowCollateralFactor).to.be.equal(configuratorLinkAssetConfig.borrowCollateralFactor);
    expect(linkAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorLinkAssetConfig.liquidateCollateralFactor);
    expect(linkAssetConfig.liquidationFactor).to.be.equal(configuratorLinkAssetConfig.liquidationFactor);
    expect(linkAssetConfig.supplyCap).to.be.equal(configuratorLinkAssetConfig.supplyCap);

    // 3. Expect that the Fauceteer has received half of the LINK total supply
    expect(await LINK.balanceOf(fauceteer.address)).to.be.equal(exp(500_000_000, 18)); // Half of 1bn total supply
  },
});
