import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { CometRewards, CometRewards__factory, GovernorSimple } from '../../../build/types';

interface Vars {
  rewards: string,
};

// XXX Bulker works with WETH right now. We'll probably need a custom one for WAVAX.
migration<Vars>('1651257139_rewards', {
  prepare: async (deploymentManager: DeploymentManager) => {
    await deploymentManager.hre.run('compile');

    const governor = await deploymentManager.contract('governor') as GovernorSimple;

    const newRewards = await deploymentManager.deploy<CometRewards, CometRewards__factory, [string]>(
      'CometRewards.sol',
      [governor.address]
    );

    return {
      rewards: newRewards.address,
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts: Vars) => {
    // No proposal needs to be created
    // Maybe seed CometRewards with COMP rewards?
    //  NB: there is/won't be COMP on fuji/avalanche
    const updatedRoots = await deploymentManager.getRoots();
    updatedRoots.set('rewards', contracts.rewards);
    deploymentManager.putRoots(updatedRoots);

    console.log("You should set roots.json to:");
    console.log("");
    console.log("");
    console.log(JSON.stringify(contracts, null, 4));
    console.log("");
  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false; // XXX
  },
});
