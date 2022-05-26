import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';

interface Vars { };

// XXX implement
migration<Vars>('1653512197_seed-rewards-with-comp', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },
  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {

  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false;
  },
});
