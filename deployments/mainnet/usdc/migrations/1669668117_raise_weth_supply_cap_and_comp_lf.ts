import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

export default migration('1669668117_raise_weth_supply_cap_and_comp_lf', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      COMP,
      WETH,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Increase supply cap for WETH
      {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, WETH.address, exp(150_000, 18)],
      },

      // 2. Increase liquidation incentive for COMP
      {
        contract: configurator,
        signature: "updateAssetLiquidationFactor(address,address,uint64)",
        args: [comet.address, COMP.address, exp(0.89, 18)],
      },

      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },
    ];
    const description = "# Update cUSDCv3 Risk Parameters\nXXX" // XXX write me
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      COMP,
      WETH,
    } = await deploymentManager.getContracts();

    const compInfo = await comet.getAssetInfoByAddress(COMP.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);

    expect(await compInfo.liquidationFactor).to.be.eq(exp(0.89, 18));
    expect(await wethInfo.supplyCap).to.be.eq(exp(150_000, 18));
  },
});
