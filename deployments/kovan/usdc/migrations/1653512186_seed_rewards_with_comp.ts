import { CometInterface, CometRewards, ERC20, GovernorSimple, ProxyAdmin, SimpleTimelock } from '../../../../build/types';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { debug } from '../../../../plugins/deployment_manager/Utils';
import { wait } from '../../../../test/helpers';

interface Vars { };

export default migration('1653512186_seed_rewards_with_comp', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    const { ethers } = deploymentManager.hre;

    const timelock = await deploymentManager.contract('timelock') as SimpleTimelock;
    const governor = await deploymentManager.contract('governor') as GovernorSimple;
    const comet = await deploymentManager.contract('comet') as CometInterface;
    const rewards = await deploymentManager.contract('rewards') as CometRewards;
    const COMP = await deploymentManager.contract('COMP') as ERC20;

    const timelockCompBalance = await COMP.balanceOf(timelock.address);
    debug(`COMP balance of Timelock: ${timelockCompBalance}`);

    // Steps:
    // 1. Set reward config in CometRewards.
    // 2. Send half of the Timelock's COMP to CometRewards.
    const setRewardConfigCalldata = ethers.utils.defaultAbiCoder.encode(["address", "address"], [comet.address, COMP.address]);
    const transferCompCalldata = ethers.utils.defaultAbiCoder.encode(["address", "uint"], [rewards.address, timelockCompBalance.div(2)]);

    // Create a new proposal and queue it up. Execution can be done manually or in a third step.
    const txn = await deploymentManager.asyncCallWithRetry(
      async (signer_) => (await governor.connect(signer_).propose(
        [
          rewards.address,
          COMP.address,
        ],
        [
          0,
          0,
        ],
        [
          "setRewardConfig(address,address)",
          "transfer(address,uint256)",
        ],
        [
          setRewardConfigCalldata,
          transferCompCalldata,
        ],
        'Set RewardConfig and transfer COMP to CometRewards')
      ).wait()
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(governor.connect(signer_).queue(proposalId))
    );

    debug(`Created proposal ${proposalId} and queued it. Proposal still needs to be executed.`);

    // await deploymentManager.asyncCallWithRetry(
    //   (signer_) => wait(governor.connect(signer_).execute(proposalId))
    // );

    // // Log out new states to manually verify (helpful to verify via simulation)
    // debug("COMP balance of Timelock: ", await COMP.balanceOf(timelock.address));
    // debug("COMP balance of CometRewards: ", await COMP.balanceOf(rewards.address));
    // debug("RewardConfig: ", await rewards.rewardConfig(comet.address));
  }
});