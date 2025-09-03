import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { extractProposalIdFromLogs } from '../deploy/helpers';

async function proposeFundCometRewards(
  deploymentManager: DeploymentManager,
  amount: string,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const trace = deploymentManager.tracer();
  
  // Get required contracts from infrastructure
  const governor = await deploymentManager.getContractOrThrow('governor');
  const timelock = await deploymentManager.getContractOrThrow('timelock');
  const COMP = await deploymentManager.getContractOrThrow('COMP');
  const rewards = await deploymentManager.getContractOrThrow('rewards');
  
  // Parse amount (expecting string like "1000000000000000000000" for 1000 COMP with 18 decimals)
  const transferAmount = BigInt(amount);
  
  // Prepare proposal data
  const targets: string[] = [];
  const values: number[] = [];
  const calldatas: string[] = [];

  // Action: Have timelock execute transfer of COMP tokens to CometRewards contract
  targets.push(COMP.address);
  values.push(0);
  calldatas.push(
    COMP.interface.encodeFunctionData('transfer', [
      rewards.address, transferAmount
    ])
  );
  
  const description = `Fund CometRewards contract with ${transferAmount} COMP tokens`;
  
  trace(`Creating proposal to fund CometRewards:`);
  trace(`1. COMP.transfer(${rewards.address}, ${transferAmount})`);
  trace(`   Current COMP balance of timelock: ${await COMP.balanceOf(timelock.address)}`);
  trace(`   Current COMP balance of rewards: ${await COMP.balanceOf(rewards.address)}`);
  
  // Submit proposal to governor
  trace(`Submitting funding proposal to governor`);
  
  const tx = await governor.connect(admin).propose(
    targets,
    values,
    calldatas,
    description
  );
  
  const receipt = await tx.wait();
  trace(`Funding proposal submitted! Transaction hash: ${receipt.transactionHash}`);
  
  // Extract proposal ID from ProposalCreated event
  const proposalId = extractProposalIdFromLogs(governor, receipt);
  if (proposalId !== null) {
    trace(`Proposal ID: ${proposalId}`);
  } else {
    trace(`Warning: Could not find ProposalCreated event in logs`);
  }

  return {
    targets,
    values,
    calldatas,
    description,
    governor: governor.address,
    timelock: timelock.address,
    rewards: rewards.address,
    COMP: COMP.address,
    amount: transferAmount,
    proposalId,
    tx: receipt
  };
}

export default async function fundCometRewardsTask(
  hre: HardhatRuntimeEnvironment, 
  amount: string
) {
  if (!amount) {
    throw new Error('Amount is required (in wei, e.g., "1000000000000000000000" for 1000 COMP)');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Proposing to fund CometRewards with ${amount} COMP tokens...`);
  
  try {
    const result = await proposeFundCometRewards(deploymentManager, amount);
    
    console.log(`✅ CometRewards funding proposal submitted successfully!`);
    console.log(`   Proposal ID: ${result.proposalId}`);
    console.log(`   Amount: ${result.amount} COMP tokens`);
    console.log(`   From: ${result.timelock} (timelock)`);
    console.log(`   To: ${result.rewards} (CometRewards)`);
    console.log(`   Transaction hash: ${result.tx.transactionHash}`);
    console.log(`   Description: ${result.description}`);
    
    return result;
  } catch (error) {
    trace(`❌ Failed to propose CometRewards funding: ${error}`);
    throw error;
  }
} 