import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

export default migration('1663794398_bump_supply_caps', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      COMP,
      WBTC,
      WETH,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Increase supply caps for each of the assets
      {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, COMP.address, exp(600_000, 18)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, WBTC.address, exp(6_000, 8)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, WETH.address, exp(75_000, 18)],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },
    ];
    const description = "# Increase Compound III Supply Caps\n\nThis proposal begins raising collateral supply caps, so that Compound III can continue expanding past its trial phase. The changes are specified on the [governance forum](https://www.comp.xyz/t/compound-iii-supply-caps/3628) and summarized below:\n\n**Proposed Supply Caps**\n\n75,000 ETH ($97M)\n6,000 WBTC ($112M)\n600,000 COMP ($36M)\n\n**Proposal**\n\nThe first three actions of [the proposal](https://github.com/compound-finance/comet/pull/576) raise supply caps for COMP, WBTC, and WETH accordingly, in the Configurator.  The fourth action deploys a new implementation from the Configurator and upgrades the market to use the new implementation.";
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      COMP,
      WBTC,
      WETH,
    } = await deploymentManager.getContracts();

    const compInfo = await comet.getAssetInfoByAddress(COMP.address);
    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);

    expect(await compInfo.supplyCap).to.be.eq(exp(600_000, 18));
    expect(await wbtcInfo.supplyCap).to.be.eq(exp(6_000, 8));
    expect(await wethInfo.supplyCap).to.be.eq(exp(75_000, 18));
  },
});
