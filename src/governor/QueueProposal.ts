import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

interface QueueResult {
  proposalId: number;
  tx: any;
  eta: number;
  executionTime: Date;
  timelockDelay: number;
  alreadyQueued?: boolean;
}

interface ProposalInfo {
  eta: number;
  state: number;
  executionTime: Date;
  timelockDelay: number;
}

async function getTimelockDelay(deploymentManager: DeploymentManager): Promise<number> {
  try {
    const timelockContract = await deploymentManager.getContractOrThrow('timelock');
    const delay = await timelockContract.delay();
    return delay.toNumber();
  } catch (error) {
    // Fallback to a default delay if timelock contract is not available
    return 172800; // 2 days in seconds (common default)
  }
}

async function getProposalInfo(deploymentManager: DeploymentManager, proposalId: number): Promise<ProposalInfo> {
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const timelockDelay = await getTimelockDelay(deploymentManager);
  
  // Get proposal details
  const proposal = await governorContract.proposals(proposalId);
  const state = await governorContract.state(proposalId);
  
  const eta = proposal.eta.toNumber();
  const executionTime = new Date(eta * 1000);
  
  return {
    eta,
    state,
    executionTime,
    timelockDelay
  };
}

function formatTimeRemaining(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (remainingSeconds > 0) parts.push(`${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''}`);

  return parts.join(', ');
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
}

function getStateName(state: number): string {
  const stateNames = ['Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];
  return stateNames[state] || 'Unknown';
}

async function queueCometProposal(
  deploymentManager: DeploymentManager,
  proposalId: number,
  adminSigner?: SignerWithAddress
): Promise<QueueResult> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const trace = deploymentManager.tracer();
  
  trace(`Queueing proposal ${proposalId} by admin ${admin.address}`);
  
  // Get timelock delay before queueing
  const timelockDelay = await getTimelockDelay(deploymentManager);
  trace(`Timelock delay: ${timelockDelay} seconds (${formatTimeRemaining(timelockDelay)})`);
  
  const tx = await governorContract.connect(admin).queue(proposalId);
  const receipt = await tx.wait();
  
  trace(`Proposal ${proposalId} queued! Transaction hash: ${receipt.transactionHash}`);
  
  // Calculate execution time
  const currentTime = Math.floor(Date.now() / 1000);
  const eta = currentTime + timelockDelay;
  const executionTime = new Date(eta * 1000);
  
  return { 
    proposalId, 
    tx: receipt, 
    eta,
    executionTime,
    timelockDelay,
    alreadyQueued: false
  };
}

function displayTimingInformation(proposalId: number, proposalInfo: ProposalInfo): void {
  console.log(`\n⏰ Execution Timing Information:`);
  console.log(`   Timelock delay: ${formatTimeRemaining(proposalInfo.timelockDelay)}`);
  console.log(`   ETA (Unix timestamp): ${proposalInfo.eta}`);
  console.log(`   Execution time: ${formatDate(proposalInfo.executionTime)}`);
  console.log(`   Proposal state: ${getStateName(proposalInfo.state)}`);
  
  const now = new Date();
  const timeUntilExecution = Math.max(0, proposalInfo.executionTime.getTime() - now.getTime());
  const secondsUntilExecution = Math.floor(timeUntilExecution / 1000);
  
  if (secondsUntilExecution > 0) {
    console.log(`   Time until execution: ${formatTimeRemaining(secondsUntilExecution)}`);
    console.log(`\n💡 You can execute this proposal after ${formatDate(proposalInfo.executionTime)}`);
  } else {
    console.log(`   ⚡ Proposal is ready for execution now!`);
  }
  
  console.log(`\n📋 Next steps:`);
  console.log(`   1. Wait for the timelock delay period to pass`);
  console.log(`   2. Execute the proposal: yarn hardhat governor:execute --network ${process.env.HARDHAT_NETWORK || 'local'} --proposal-id ${proposalId}`);
  console.log(`   3. Or use the complete governance flow script for automated processing`);
}

export default async function queueProposal(hre: HardhatRuntimeEnvironment, proposalId: number) {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Queueing proposal ${proposalId}...`);
  
  let queueResult: QueueResult | null = null;
  let queueError: Error | null = null;
  
  // Try to queue the proposal
  try {
    queueResult = await queueCometProposal(deploymentManager, proposalId);
    console.log(`\n✅ Proposal ${proposalId} queued successfully!`);
    console.log(`   Transaction hash: ${queueResult.tx.transactionHash}`);
  } catch (error) {
    queueError = error;
    console.log(`\n⚠️  Failed to queue proposal ${proposalId}: ${error.message}`);
    console.log(`   This might be because the proposal is already queued or in an invalid state.`);
  }
  
  // Always try to get proposal information to show timing details
  try {
    const proposalInfo = await getProposalInfo(deploymentManager, proposalId);
    
    if (queueResult) {
      // Proposal was successfully queued, show timing info
      displayTimingInformation(proposalId, proposalInfo);
      return queueResult;
    } else {
      // Proposal queueing failed, but show current status
      console.log(`\n📊 Current Proposal Status:`);
      console.log(`   Proposal state: ${getStateName(proposalInfo.state)}`);
      
      if (proposalInfo.state === 5) { // Queued state
        console.log(`\n✅ Proposal is already queued!`);
        displayTimingInformation(proposalId, proposalInfo);
        return {
          proposalId,
          tx: null,
          eta: proposalInfo.eta,
          executionTime: proposalInfo.executionTime,
          timelockDelay: proposalInfo.timelockDelay,
          alreadyQueued: true
        };
      } else {
        console.log(`\n❌ Proposal cannot be queued in its current state (${getStateName(proposalInfo.state)})`);
        if (queueError) {
          throw queueError;
        }
      }
    }
  } catch (error) {
    trace(`❌ Failed to get proposal information: ${error}`);
    if (queueError) {
      throw queueError;
    }
    throw error;
  }
}
