import { ethers } from 'ethers';
import { CometInterface, CometRewards, ERC20, GovernorSimple, ProxyAdmin, SimpleTimelock } from '../../../build/types';
import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';

interface Vars { };

migration<Vars>('1653512186_seed_rewards_with_comp', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },
  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    const signer = await deploymentManager.getSigner();

    const timelock = await deploymentManager.contract('timelock') as SimpleTimelock;
    const governor = await deploymentManager.contract('governor') as GovernorSimple;
    const comet = await deploymentManager.contract('comet') as CometInterface;
    const rewards = await deploymentManager.contract('rewards') as CometRewards;
    const COMP = await deploymentManager.contract('COMP') as ERC20;

    console.log('Governor ', governor.address)
    console.log('Timelock ', timelock.address)
    console.log('Rewards ', rewards.address)

    const timelockCompBalance = await COMP.balanceOf(timelock.address);
    console.log('COMP balance of Timelock: ', timelockCompBalance);

    // Steps:
    // 1. Set reward config in CometRewards.
    // 2. Send half of the Timelock's COMP to CometRewards.
    const setRewardConfigCalldata = ethers.utils.defaultAbiCoder.encode(["address", "address"], [comet.address, COMP.address]);
    const transferCompCalldata = ethers.utils.defaultAbiCoder.encode(["address", "uint"], [rewards.address, timelockCompBalance.div(2)]);

    const governorAsAdmin = governor.connect(signer);

    // Create a new proposal and queue it up. Execution can be done manually or in a third step.
    let tx = await (await governorAsAdmin.propose(
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
    ).wait();
    let event = tx.events.find(event => event.event === 'ProposalCreated');
    let [proposalId] = event.args;

    await governorAsAdmin.queue(proposalId);

    console.log(`Created proposal ${proposalId} and queued it. Proposal still needs to be executed.`);

    // XXX create a third step that actually executes the proposal on testnet and logs the results
    // await governorAsAdmin.execute(proposalId);
    // // Log out new states to manually verify (helpful to verify via simulation)
    // console.log("COMP balance of Timelock: ", await COMP.balanceOf(timelock.address));
    // console.log("COMP balance of CometRewards: ", await COMP.balanceOf(rewards.address));
    // console.log("RewardConfig: ", await rewards.rewardConfig(comet.address));
  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false;
  },
});
