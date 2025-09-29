import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ProposalService } from '../services/ProposalService';

/**
 * Task for approving proposals
 */
export default async function approveProposalTask(
  hre: HardhatRuntimeEnvironment, 
  proposalId: number
): Promise<any> {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  
  if (!deploymentManager) {
    throw new Error('DeploymentManager not found. Make sure to call createDeploymentManager first.');
  }
  
  console.log(`Approving proposal ${proposalId}...`);
  
  try {
    const service = new ProposalService(deploymentManager);
    
    // First, check the current approval status
    console.log(`\n🔍 Checking approval status for proposal ${proposalId}...`);
    const approvalInfo = await service.getProposalApprovalInfo(proposalId);
    
    console.log(`\n📊 Current Approval Status:`);
    console.log(`   Current approvals: ${approvalInfo.currentApprovals}`);
    console.log(`   Required approvals: ${approvalInfo.requiredApprovals}`);
    console.log(`   Total admins: ${approvalInfo.totalAdmins}`);
    console.log(`   Has enough approvals: ${approvalInfo.hasEnoughApprovals ? 'Yes' : 'No'}`);
    console.log(`   Proposal state: ${approvalInfo.state}`);
    
    if (approvalInfo.hasEnoughApprovals) {
      console.log(`\n✅ Proposal already has enough approvals!`);
      console.log(`💡 You can proceed to queue and execute the proposal.`);
      return { proposalId, state: approvalInfo.state, alreadyApproved: true };
    }
    
    const approvalsNeeded = approvalInfo.requiredApprovals - approvalInfo.currentApprovals;
    console.log(`\n📝 Approvals needed: ${approvalsNeeded}`);
    
    // Proceed with approval
    const result = await service.approveProposal(proposalId);
    
    console.log(`\n✅ Proposal ${proposalId} approved successfully!`);
    console.log(`   Proposal state: ${result.state}`);
    console.log(`   Transaction hash: ${result.tx.transactionHash}`);
    
    // Check approval status again after approval
    console.log(`\n📊 Checking updated approval status...`);
    const newApprovalInfo = await service.getProposalApprovalInfo(proposalId);
    
    console.log(`\n📊 Updated Approval Status:`);
    console.log(`   Current approvals: ${newApprovalInfo.currentApprovals}`);
    console.log(`   Required approvals: ${newApprovalInfo.requiredApprovals}`);
    console.log(`   Has enough approvals: ${newApprovalInfo.hasEnoughApprovals ? 'Yes' : 'No'}`);
    
    if (newApprovalInfo.hasEnoughApprovals) {
      console.log(`\n🎉 Proposal now has enough approvals!`);
      console.log(`💡 Next steps:`);
      console.log(`   1. Queue the proposal: yarn hardhat governor:queue --network ${hre.network.name} --proposal-id ${proposalId}`);
      console.log(`   2. Execute the proposal: yarn hardhat governor:execute --network ${hre.network.name} --proposal-id ${proposalId}`);
    } else {
      const stillNeeded = newApprovalInfo.requiredApprovals - newApprovalInfo.currentApprovals;
      console.log(`\n📝 Still need ${stillNeeded} more approval(s)`);
      console.log(`💡 Other admins can approve using the same command`);
    }
    
    return { ...result, approvalInfo: newApprovalInfo };
  } catch (error) {
    console.error(`❌ Failed to approve proposal ${proposalId}:`, error);
    throw error;
  }
}
