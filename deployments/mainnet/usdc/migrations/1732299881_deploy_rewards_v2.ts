import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

const MULTISIG_ADDRESS = '0xbbf3f1421d886e9b2c5d716b5192ac998af2012c';

export default migration('1732299881_deploy_rewards_v2', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometRewardsV2 = await deploymentManager.deploy(
      'rewardsV2',
      'CometRewardsV2.sol',
      [
        MULTISIG_ADDRESS,   // The governor who will control the contract
      ]
    );
    return { cometRewardsV2Address: cometRewardsV2.address };
  },

  enact: async () => {
    //
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const cometRewardsV2 = await deploymentManager.fromDep('rewardsV2', 'mainnet', 'usdc');
    expect(MULTISIG_ADDRESS.toLowerCase()).to.be.equal((await cometRewardsV2.governor()).toLowerCase());
  },
});
