import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {
  newWBTCPriceFeed: string
};

export default migration('1687890699_temp', {
  prepare: async (deploymentManager: DeploymentManager) => {
    // Hardcoded price feed address because artifact from 5 months ago has expired
    return { newWBTCPriceFeed: "0x45939657d1CA34A8FA39A924B71D28Fe8431e581" };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
  },
});
