import { ProposalService } from './ProposalService';
import { Proposal } from '../models';
import { utils } from 'ethers';

/**
 * Service for timelock-related operations
 */
export class TimelockService extends ProposalService {

  /**
   * Get current timelock delay
   */
  async getCurrentDelay(): Promise<number> {
    const timelock = await this.getTimelock();
    const delay = await timelock.delay();
    return delay.toNumber();
  }

  /**
   * Create a timelock delay change proposal
   */
  async createTimelockDelayProposal(newDelay: number): Promise<any> {
    if (newDelay <= 0) {
      throw new Error('Timelock delay must be greater than 0');
    }

    const currentDelay = await this.getCurrentDelay();
    const timelock = await this.getTimelock();
    const delayBN = utils.parseUnits(newDelay.toString(), 0);

    console.log('📋 Creating timelock delay change proposal...');
    console.log(`   Current delay: ${currentDelay} seconds`);
    console.log(`   New delay: ${newDelay} seconds`);

    const proposal: Proposal = {
      targets: [timelock.address],
      values: [0],
      calldatas: [
        timelock.interface.encodeFunctionData('setDelay', [delayBN])
      ],
      description: `Change timelock delay from ${currentDelay} seconds to ${newDelay} seconds`
    };

    const result = await this.createProposal(proposal);
    
    return {
      ...result,
      currentDelay,
      newDelay,
      delayBN: delayBN.toString()
    };
  }

  /**
   * Queue a proposal
   */
  async queueProposal(proposalId: number): Promise<any> {
    const admin = await this.getAdminSigner();
    const governor = await this.getGovernor();
    const timelockDelay = await this.getCurrentDelay();
    
    console.log(`Queueing proposal ${proposalId} by admin ${admin.address}`);
    console.log(`Timelock delay: ${timelockDelay} seconds`);
    
    const tx = await governor.connect(admin).queue(proposalId);
    const receipt = await tx.wait();
    
    console.log(`Proposal ${proposalId} queued! Transaction hash: ${receipt.transactionHash}`);
    
    // Calculate execution time
    const currentTime = Math.floor(Date.now() / 1000);
    const eta = currentTime + timelockDelay;
    const executionTime = new Date(eta * 1000);
    
    return { 
      proposalId, 
      transactionHash: receipt.transactionHash,
      eta,
      executionTime,
      timelockDelay,
      alreadyQueued: false
    };
  }

  /**
   * Get proposal timing information
   */
  async getProposalTiming(proposalId: number): Promise<any> {
    const governor = await this.getGovernor();
    const timelockDelay = await this.getCurrentDelay();
    
    const proposal = await governor.proposals(proposalId);
    const eta = proposal.eta.toNumber();
    const executionTime = new Date(eta * 1000);
    
    const now = new Date();
    const timeUntilExecution = Math.max(0, executionTime.getTime() - now.getTime());
    const secondsUntilExecution = Math.floor(timeUntilExecution / 1000);
    
    return {
      eta,
      executionTime,
      timelockDelay,
      timeUntilExecution: secondsUntilExecution
    };
  }
}
