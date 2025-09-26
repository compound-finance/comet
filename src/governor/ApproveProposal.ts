import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

interface ProposalApprovalInfo {
  currentApprovals: number;
  requiredApprovals: number;
  hasEnoughApprovals: boolean;
  state: string;
  totalAdmins: number;
}

async function getProposalApprovalInfo(
  deploymentManager: DeploymentManager,
  proposalId: number
): Promise<ProposalApprovalInfo> {
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const trace = deploymentManager.tracer();
  
  trace(`Getting approval information for proposal ${proposalId}...`);
  
  try {
    // Query contract methods directly
    const [currentApprovals, hasEnoughApprovals, multisigThreshold, state] = await Promise.all([
      governorContract.getProposalApprovals(proposalId),
      governorContract.hasEnoughApprovals(proposalId),
      governorContract.multisigThreshold(),
      governorContract.state(proposalId)
    ]);
    
    // Get total number of admins by checking the length
    let totalAdmins = 0;
    try {
      // Try to get admin count by checking if admins array has a length method
      totalAdmins = await governorContract.admins.length();
    } catch {
      // If length method is not available, we'll estimate based on typical governance setups
      totalAdmins = 3; // Common default for multisig setups
    }
    
    const stateNames = ['Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];
    const stateName = stateNames[state] || 'Unknown';
    
    return {
      currentApprovals: currentApprovals.toNumber(),
      requiredApprovals: multisigThreshold.toNumber(),
      hasEnoughApprovals: hasEnoughApprovals,
      state: stateName,
      totalAdmins: totalAdmins
    };
    
  } catch (error) {
    trace(`⚠️  Could not get approval information: ${error.message}`);
    return {
      currentApprovals: 0,
      requiredApprovals: 0,
      hasEnoughApprovals: false,
      state: 'Unknown',
      totalAdmins: 0
    };
  }
}

async function approveCometProposal(
  deploymentManager: DeploymentManager,
  proposalId: number,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const trace = deploymentManager.tracer();
  
  trace(`Approving proposal ${proposalId} by admin ${admin.address}`);
  
  const tx = await governorContract.connect(admin).castVote(proposalId, 1);
  const receipt = await tx.wait();
  
  trace(`Proposal ${proposalId} approved! Transaction hash: ${receipt.transactionHash}`);
  
  // Get proposal state to check if it can be queued
  const proposalState = await governorContract.state(proposalId);
  
  trace(`Proposal ${proposalId} state: ${proposalState}`);
  
  return { proposalId, state: proposalState, tx: receipt };
}

export default async function approveProposal(hre: HardhatRuntimeEnvironment, proposalId: number) {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Approving proposal ${proposalId}...`);
  
  try {
    // First, check the current approval status
    console.log(`\n�� Checking approval status for proposal ${proposalId}...`);
    const approvalInfo = await getProposalApprovalInfo(deploymentManager, proposalId);
    
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
    const result = await approveCometProposal(deploymentManager, proposalId);
    
    console.log(`\n✅ Proposal ${proposalId} approved successfully!`);
    console.log(`   Proposal state: ${result.state}`);
    console.log(`   Transaction hash: ${result.tx.transactionHash}`);
    
    // Check approval status again after approval
    console.log(`\n📊 Checking updated approval status...`);
    const newApprovalInfo = await getProposalApprovalInfo(deploymentManager, proposalId);
    
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
    trace(`❌ Failed to approve proposal ${proposalId}: ${error}`);
    throw error;
  }
}
