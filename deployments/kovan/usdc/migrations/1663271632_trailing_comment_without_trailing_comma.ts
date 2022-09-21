import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars { };

export default migration('1663271632_trailing_comment_without_trailing_comma', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    // No governance changes
  } // Trailing comment
});