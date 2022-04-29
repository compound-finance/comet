import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { Bulker, Bulker__factory, CometRewards, CometRewards__factory, CometInterface, GovernorSimple } from '../../../build/types';

interface Vars {
  bulker: string,
  rewards: string,
};

migration<Vars>('1651257129_bulker_and_rewards', {
  prepare: async (deploymentManager: DeploymentManager) => {
    await deploymentManager.hre.run('compile');

    const comet = await deploymentManager.contract('comet') as CometInterface;
    const weth = await deploymentManager.contract('weth');
    const governor = await deploymentManager.contract('governor') as GovernorSimple;

    // Deploy new Bulker and Rewards contracts
    const newBulker = await deploymentManager.deploy<Bulker, Bulker__factory, [string, string]>(
      'Bulker.sol',
      [comet.address, weth.address]
    );

    const newRewards = await deploymentManager.deploy<CometRewards, CometRewards__factory, [string]>(
      'CometRewards.sol',
      [governor.address]
    );

    return {
      bulker: newBulker.address,
      rewards: newRewards.address,
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts: Vars) => {
    // No proposal needs to be created
    // Maybe seed CometRewards with COMP rewards?
    deploymentManager.putRoots(new Map(Object.entries(contracts)));

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
