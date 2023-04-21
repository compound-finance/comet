import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';

const clone = {
  governorImpl: '0xeF3B6E9e13706A8F01fe98fdCf66335dc5CfdEED'
};

const OLD_GOVERNOR_IMPL_ADDRESS = '0x9d26789c7b2492E6015B26dc75C79AeA71a7211c';

export default migration('1681942579_upgrade_governor_bravo', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const { governor } = await deploymentManager.getContracts();

    // Deploy new governor implementation (cloned from mainnet)
    const newGovernorImpl = await deploymentManager.clone(
      'newGovernorImpl',
      clone.governorImpl,
      [],
      'mainnet'
    );

    const actions = [
      // 1. Set implementation of the governor to the new governor implementation
      {
        target: governor.address,
        signature: '_setImplementation(address)',
        calldata: ethers.utils.defaultAbiCoder.encode(['address'], [newGovernorImpl.address])
      }
    ];
    const description =
      '# Update governor implementation\n\n## Explanation\n\nUpdates the governor implementation to allow for sending ETH from the Timelock. \n';
    const txn = await deploymentManager.retry(async () =>
      governor.propose(...(await proposal(actions, description)))
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
    await deploymentManager.spider(); // We spider here to pull in the updated governor impl address
    const { 'governor:implementation': governorImpl } = await deploymentManager.getContracts();

    // 1.
    expect(governorImpl.address).to.not.be.eq(OLD_GOVERNOR_IMPL_ADDRESS);
  }
});
