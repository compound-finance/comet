import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { utils } from 'ethers';

async function proposeTimelockDelayChangeAction(
  deploymentManager: DeploymentManager,
  delay: string,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const trace = deploymentManager.tracer();

  // Get required contracts
  const governor = await deploymentManager.getContractOrThrow('governor');
  const timelock = await deploymentManager.getContractOrThrow('timelock');

  // Get current delay for comparison
  const currentDelay = await timelock.delay();
  const delayBN = utils.parseUnits(delay, 0); // Assuming delay is in seconds

  trace(`Current timelock delay: ${currentDelay} seconds`);
  trace(`Proposed new delay: ${delayBN} seconds`);

  // Prepare proposal data directly
  const targets: string[] = [];
  const values: number[] = [];
  const calldatas: string[] = [];

  // Action: change the timelock delay
  targets.push(timelock.address);
  values.push(0);
  calldatas.push(
    timelock.interface.encodeFunctionData('setDelay', [delayBN])
  );

  const description = `Change timelock delay from ${currentDelay} seconds to ${delayBN} seconds`;

  trace(`Creating timelock delay change proposal:`);
  trace(`1. setDelay(${delayBN}) on ${timelock.address}`);

  // Submit proposal to governor
  trace(`Submitting proposal to governor`);

  const tx = await governor.connect(admin).propose(
    targets,
    values,
    calldatas,
    description
  );

  const receipt = await tx.wait();
  trace(`Proposal submitted! Transaction hash: ${receipt.transactionHash}`);

  // Extract proposal ID from ProposalCreated event
  const proposalCreatedEvent = receipt.events?.find(
    (event: any) => event.event === 'ProposalCreated'
  );
  
  let proposalId = null;
  if (proposalCreatedEvent) {
    proposalId = proposalCreatedEvent.args.proposalId;
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
    currentDelay: currentDelay.toString(),
    newDelay: delayBN.toString(),
    proposalId,
    tx: receipt
  };
}

export default async function proposeTimelockDelayChangeTask(
  hre: HardhatRuntimeEnvironment, 
  delay: string
) {
  if (!delay) {
    throw new Error('Delay value is required');
  }

  // Validate delay format (should be a positive integer)
  const delayNumber = parseInt(delay);
  if (isNaN(delayNumber) || delayNumber < 0) {
    throw new Error('Delay must be a positive integer');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Proposing timelock delay change to ${delay} seconds...`);
  
  try {
    const result = await proposeTimelockDelayChangeAction(deploymentManager, delay);
    
    console.log(`✅ Timelock delay change proposal submitted successfully!`);
    console.log(`   Proposal ID: ${result.proposalId || 'Unknown'}`);
    console.log(`   Current delay: ${result.currentDelay} seconds`);
    console.log(`   New delay: ${result.newDelay} seconds`);
    console.log(`   Transaction hash: ${result.tx.transactionHash}`);
    console.log(`   Description: ${result.description}`);
    
    return result;
  } catch (error) {
    trace(`❌ Failed to propose timelock delay change: ${error}`);
    throw error;
  }
} 