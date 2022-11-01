import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

export default migration('1665028496_absorb_transfer_event_and_auto_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometFactory = await deploymentManager.deploy('cometFactory', 'CometFactory.sol', [], true);
    return { newFactoryAddress: cometFactory.address };
  },

  async enact(deploymentManager: DeploymentManager, { newFactoryAddress }) {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      COMP,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Set comet factory to newly deployed factory
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, newFactoryAddress],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];
    const description = "# Liquidation Event Handling And Collateral Reserves\n";
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
    // 1. & 2.
    //  added a scenario to check for new Transfer event
  }
});
