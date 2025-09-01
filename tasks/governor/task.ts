import { task } from 'hardhat/config';
import { DeploymentManager } from '../../plugins/deployment_manager';
import approveProposal from '../../src/governor/ApproveProposal';
import queueProposal from '../../src/governor/QueueProposal';
import executeProposal from '../../src/governor/ExecuteProposal';
import getProposalStatus from '../../src/governor/GetProposalStatus';
import proposeCometUpgradeTask from '../../src/governor/ProposeCometUpgrade';
import fundCometRewardsTask from '../../src/governor/FundCometRewards';
import proposeGovernanceConfigTask from '../../src/governor/ProposeGovernanceConfig';

// Helper function to create deployment manager
async function createDeploymentManager(hre: any, deployment?: string) {
  const network = hre.network.name;
  const dm = new DeploymentManager(
    network,
    deployment ?? '_infrastructure',
    hre,
    {
      writeCacheToDisk: true,
      verificationStrategy: 'lazy',
    }
  );
  await dm.spider();
  
  // Attach deployment manager to hre
  (hre as any).deploymentManager = dm;
  return dm;
}

// Task to approve a proposal
task('governor:approve', 'Approve a proposal')
  .addParam('proposalId', 'The proposal ID to approve')
  .addOptionalParam('deployment', 'The deployment to use')
  .setAction(async (taskArgs, hre) => {
    const deployment = taskArgs.deployment;
    // Create deployment manager
    await createDeploymentManager(hre, deployment);
    
    const proposalId = parseInt(taskArgs.proposalId);
    
    console.log(`Approving proposal ${proposalId}...`);
    
    try {
      const result = await approveProposal(hre, proposalId);
      return result;
    } catch (error) {
      console.error(`❌ Failed to approve proposal ${proposalId}:`, error);
      throw error;
    }
  });

// Task to queue a proposal
task('governor:queue', 'Queue a proposal')
  .addParam('proposalId', 'The proposal ID to queue')
  .addOptionalParam('deployment', 'The deployment to use')
  .setAction(async (taskArgs, hre) => {
    const deployment = taskArgs.deployment;
    // Create deployment manager
    await createDeploymentManager(hre, deployment);
    
    const proposalId = parseInt(taskArgs.proposalId);
    
    console.log(`Queueing proposal ${proposalId}...`);
    
    try {
      const result = await queueProposal(hre, proposalId);
      return result;
    } catch (error) {
      console.error(`❌ Failed to queue proposal ${proposalId}:`, error);
      throw error;
    }
  });

// Task to execute a proposal
task('governor:execute', 'Execute a proposal')
  .addParam('proposalId', 'The proposal ID to execute')
  .addParam('executionType', 'The execution type (comet-impl-in-configuration, comet-upgrade, governance-config)')
  .addOptionalParam('deployment', 'The deployment to use')
  .setAction(async (taskArgs, hre) => {
    const deployment = taskArgs.deployment;
    await createDeploymentManager(hre, deployment);
    
    const proposalId = parseInt(taskArgs.proposalId);
    const executionType = taskArgs.executionType;
    
    console.log(`Executing proposal ${proposalId} with execution type: ${executionType}...`);
    
    try {
      const result = await executeProposal(hre, proposalId, executionType);
      return result;
    } catch (error) {
      console.error(`❌ Failed to execute proposal ${proposalId}:`, error);
      throw error;
    }
  });

// Task to check proposal status
task('governor:status', 'Check proposal status')
  .addParam('proposalId', 'The proposal ID to check')
  .addOptionalParam('deployment', 'The deployment to use')
  .setAction(async (taskArgs, hre) => {
    const deployment = taskArgs.deployment;
    // Create deployment manager
    await createDeploymentManager(hre, deployment);
    
    const proposalId = parseInt(taskArgs.proposalId);
    
    console.log(`Checking status of proposal ${proposalId}...`);
    
    try {
      const result = await getProposalStatus(hre, proposalId);
      return result;
    } catch (error) {
      console.error(`❌ Failed to check proposal ${proposalId}:`, error);
      throw error;
    }
  });

// Task to propose Comet upgrade
task('governor:propose-upgrade', 'Propose a Comet implementation upgrade')
  .addParam('implementation', 'The new implementation address')
  .addParam('deployment', 'The deployment to use')
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    const newImplementationAddress = taskArgs.implementation;
    const deployment = taskArgs.deployment;
    
    await createDeploymentManager(hre, deployment);
    
    console.log(`Proposing Comet upgrade to ${newImplementationAddress}...`);
    
    try {
      const result = await proposeCometUpgradeTask(hre, newImplementationAddress);
      return result;
    } catch (error) {
      console.error(`❌ Failed to propose Comet upgrade:`, error);
      throw error;
    }
  }); 

// Task to propose funding CometRewards
task('governor:fund-comet-rewards', 'Propose to fund CometRewards contract with COMP tokens')
  .addParam('amount', "The amount of COMP tokens to transfer (in wei, e.g., '1000000000000000000000' for 1000 COMP)")
  .setAction(async (taskArgs, hre) => {
    const amount = taskArgs.amount;

    await createDeploymentManager(hre);
    
    console.log(`Proposing to fund CometRewards with ${amount} COMP tokens...`);
    
    try {
      const result = await fundCometRewardsTask(hre, amount);
      return result;
    } catch (error) {
      console.error(`❌ Failed to propose CometRewards funding:`, error);
      throw error;
    }
  });

// Task to propose governance configuration changes
task('governor:propose-governance-config', 'Propose changes to governance configuration (admins and threshold)')
  .addParam('admins', "Comma-separated list of new admin addresses (e.g., '0x123...,0x456...,0x789...')")
  .addParam('threshold', 'New multisig threshold (number of required approvals)')
  .addParam('deployment', 'The deployment to use')
  .setAction(async (taskArgs, hre) => {
    const adminsParam = taskArgs.admins;
    const threshold = parseInt(taskArgs.threshold);
    const deployment = taskArgs.deployment;
    
    await createDeploymentManager(hre, deployment);
    
    // Parse admin addresses
    const admins = adminsParam.split(',').map((addr: string) => addr.trim());
    
    // Validate inputs
    if (admins.length === 0) {
      throw new Error('❌ At least one admin address is required');
    }
    
    if (threshold <= 0) {
      throw new Error('❌ Threshold must be greater than 0');
    }
    
    if (threshold > admins.length) {
      throw new Error('❌ Threshold cannot be greater than the number of admins');
    }
    
    // Validate addresses
    for (const admin of admins) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(admin)) {
        throw new Error(`❌ Invalid admin address: ${admin}`);
      }
    }
    
    console.log(`Proposing governance configuration change:`);
    console.log(`  New admins: ${admins.join(', ')}`);
    console.log(`  New threshold: ${threshold}`);
    
    try {
      const result = await proposeGovernanceConfigTask(hre, admins, threshold);
      return result;
    } catch (error) {
      console.error(`❌ Failed to propose governance configuration change:`, error);
      throw error;
    }
  }); 