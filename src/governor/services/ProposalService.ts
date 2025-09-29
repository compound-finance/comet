import { DeploymentManager } from '../../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { extractProposalIdFromLogs } from '../../deploy/helpers';
import { Proposal, ProposalResult, ProposalState, ProposalApprovalInfo } from '../models';
import { createProposalManager } from '../helpers/proposalManager';

/**
 * Base service for proposal operations
 */
export class ProposalService {
  constructor(protected deploymentManager: DeploymentManager) {}

  /**
   * Get the governor contract
   */
  protected async getGovernor() {
    return await this.deploymentManager.getContractOrThrow('governor');
  }

  /**
   * Get the timelock contract
   */
  protected async getTimelock() {
    return await this.deploymentManager.getContractOrThrow('timelock');
  }

  /**
   * Get the admin signer
   */
  protected async getAdminSigner(): Promise<SignerWithAddress> {
    return await this.deploymentManager.getSigner();
  }

  /**
   * Create a proposal with the given data
   * Supports both immediate execution and batch deployment modes
   */
  async createProposal(proposal: Proposal): Promise<ProposalResult> {
    if (this.deploymentManager.config.batchdeploy) {
      return await this.createBatchProposal(proposal);
    } else {
      return await this.createImmediateProposal(proposal);
    }
  }

  /**
   * Create a proposal in batch mode (add actions to proposal stack)
   */
  private async createBatchProposal(proposal: Proposal): Promise<ProposalResult> {
    const proposalManager = createProposalManager(this.deploymentManager.network);
    
    // Add each action from the proposal to the proposal stack
    for (let i = 0; i < proposal.targets.length; i++) {
      await proposalManager.addAction({
        target: proposal.targets[i],
        calldata: proposal.calldatas[i]
      });
    }
    
    // Set the proposal description
    await proposalManager.setDescription(proposal.description);
    
    console.log(`✅ Added ${proposal.targets.length} actions to proposal stack`);
    console.log(`📝 Description: ${proposal.description}`);
    
    return {
      batchMode: true,
      actionsAdded: proposal.targets.length,
      description: proposal.description
    };
  }

  /**
   * Create and execute a proposal immediately
   */
  private async createImmediateProposal(proposal: Proposal): Promise<ProposalResult> {
    const governor = await this.getGovernor();
    const admin = await this.getAdminSigner();

    console.log(`Creating proposal: ${proposal.description}`);
    console.log(`   Targets: ${proposal.targets.length}`);
    console.log(`   Actions: ${proposal.targets.length}`);

    const tx = await governor.connect(admin).propose(
      proposal.targets,
      proposal.values,
      proposal.calldatas,
      proposal.description
    );

    const receipt = await tx.wait();
    const proposalId = extractProposalIdFromLogs(governor, receipt);

    if (!proposalId) {
      throw new Error('Proposal ID not found in transaction receipt');
    }

    console.log(`✅ Proposal created successfully!`);
    console.log(`   Proposal ID: ${proposalId}`);
    console.log(`   Transaction hash: ${tx.hash}`);
    console.log(`   Block number: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

    return {
      proposalId: proposalId.toString(),
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      proposal: {
        ...proposal,
        id: proposalId.toString(),
        proposer: admin.address
      },
      batchMode: false,
      description: proposal.description
    };
  }

  /**
   * Get proposal status
   */
  async getProposalStatus(proposalId: number): Promise<{ proposal: any, state: number }> {
    const governor = await this.getGovernor();
    
    const proposal = await governor.proposals(proposalId);
    const state = await governor.state(proposalId);
    
    return { proposal, state };
  }

  /**
   * Get proposal approval information
   */
  async getProposalApprovalInfo(proposalId: number): Promise<ProposalApprovalInfo> {
    const governor = await this.getGovernor();
    
    try {
      const [currentApprovals, hasEnoughApprovals, multisigThreshold, state] = await Promise.all([
        governor.getProposalApprovals(proposalId),
        governor.hasEnoughApprovals(proposalId),
        governor.multisigThreshold(),
        governor.state(proposalId)
      ]);
      
      // Get total number of admins
      let totalAdmins = 0;
      try {
        totalAdmins = await governor.admins.length();
      } catch {
        totalAdmins = 3; // Common default for multisig setups
      }
      
      return {
        currentApprovals: currentApprovals.toNumber(),
        requiredApprovals: multisigThreshold.toNumber(),
        hasEnoughApprovals: hasEnoughApprovals,
        state: state as ProposalState,
        totalAdmins: totalAdmins
      };
    } catch (error) {
      console.log(`⚠️  Could not get approval information: ${error.message}`);
      return {
        currentApprovals: 0,
        requiredApprovals: 0,
        hasEnoughApprovals: false,
        state: ProposalState.Pending,
        totalAdmins: 0
      };
    }
  }

  /**
   * Approve a proposal
   */
  async approveProposal(proposalId: number, adminSigner?: SignerWithAddress): Promise<any> {
    const admin = adminSigner ?? await this.getAdminSigner();
    const governor = await this.getGovernor();
    
    console.log(`Approving proposal ${proposalId} by admin ${admin.address}`);
    
    const tx = await governor.connect(admin).castVote(proposalId, 1);
    const receipt = await tx.wait();
    
    console.log(`Proposal ${proposalId} approved! Transaction hash: ${receipt.transactionHash}`);
    
    const proposalState = await governor.state(proposalId);
    
    return { proposalId, state: proposalState, tx: receipt };
  }
}
