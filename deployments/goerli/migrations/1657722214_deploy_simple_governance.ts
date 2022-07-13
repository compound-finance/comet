import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { SimpleTimelock, SimpleTimelock__factory, GovernorSimple, GovernorSimple__factory } from '../../../build/types';

interface Vars {
  timelock: SimpleTimelock,
  governor: GovernorSimple,
};

migration<Vars>('1657722214_deploy_simple_governance', {
  prepare: async (deploymentManager: DeploymentManager) => {
    await deploymentManager.hre.run('compile');

    let signer = await deploymentManager.getSigner();

    // Deploy new Timelock and Governor contracts
    const newGovernor = await deploymentManager.deploy<GovernorSimple, GovernorSimple__factory, []>(
      'test/GovernorSimple.sol',
      []
    );

    const newTimelock = await deploymentManager.deploy<SimpleTimelock, SimpleTimelock__factory, [string]>(
      'test/SimpleTimelock.sol',
      [newGovernor.address]
    );

    // Initialize the storage of GovernorSimple. This sets `signer` as the only admin right now.
    await newGovernor.initialize(newTimelock.address, [signer.address]);

    return {
      timelock: newTimelock,
      governor: newGovernor
    };
  },
  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {

  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false;
  },
});
