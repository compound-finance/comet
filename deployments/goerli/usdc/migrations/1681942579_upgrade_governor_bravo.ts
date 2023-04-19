import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';

const clone = {
  governorImpl: '0xeF3B6E9e13706A8F01fe98fdCf66335dc5CfdEED'
};

export default migration('1681942579_upgrade_governor_bravo', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    const {
      governor,
    } = await deploymentManager.getContracts();

    // Deploy new governor implementation (cloned from mainnet)
    const newGovernorImpl = await deploymentManager.clone(
      'governor:implementation',
      clone.governorImpl,
      [],
      'mainnet'
    );

    const actions = [
      // 1. Set implementation of the governor to the new governor implementation
      {
        contract: governor,
        signature: '_setImplementation(address)',
        args: [newGovernorImpl.address],
      },
    ];
    const description = "# Update governor implementation\n\n## Explanation\n\nUpdates the governor implementation to allow for sending ETH from the Timelock. \n";
    const txn = await deploymentManager.retry(
      async () => governor.propose(...await proposal(actions, description))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },
});
