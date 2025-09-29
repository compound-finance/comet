import { task } from 'hardhat/config';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { 
  approveProposalTask,
  queueProposalTask,
  executeProposalTask,
  getProposalStatusTask,
  proposeCometUpgradeTask,
  proposeFundCometRewardsTask,
  proposeGovernanceUpdateTask
} from '../../src/governor/tasks';
import { createProposalManager } from '../../src/governor/helpers/proposalManager';

// Helper function to create deployment manager
async function createDeploymentManager(hre: any, deployment?: string, options?: any) {
  const network = hre.network.name;
  const dm = new DeploymentManager(
    network,
    deployment ?? '_infrastructure',
    hre,
    {
      writeCacheToDisk: true,
      verificationStrategy: 'lazy',
      ...options,
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
  .setAction(async (taskArgs, hre) => {
    const proposalId = parseInt(taskArgs.proposalId);
    
    // Create deployment manager
    await createDeploymentManager(hre);
    
    try {
      const result = await approveProposalTask(hre, proposalId);
      return result;
    } catch (error) {
      console.error(`❌ Failed to approve proposal ${proposalId}:`, error);
      throw error;
    }
  });

// Task to queue a proposal
task('governor:queue', 'Queue a proposal')
  .addParam('proposalId', 'The proposal ID to queue')
  .setAction(async (taskArgs, hre) => {
    const proposalId = parseInt(taskArgs.proposalId);
    
    // Create deployment manager
    await createDeploymentManager(hre);
    
    try {
      const result = await queueProposalTask(hre, proposalId);
      return result;
    } catch (error) {
      console.error(`❌ Failed to queue proposal ${proposalId}:`, error);
      throw error;
    }
  });

// Task to execute a proposal
task('governor:execute', 'Execute a proposal')
  .addParam('proposalId', 'The proposal ID to execute')
  .addParam('executionType', 'The execution type')
  .setAction(async (taskArgs, hre) => {
    const proposalId = parseInt(taskArgs.proposalId);
    const executionType = taskArgs.executionType;
    
    // Create deployment manager
    await createDeploymentManager(hre);
    
    try {
      const result = await executeProposalTask(hre, proposalId, executionType);
      return result;
    } catch (error) {
      console.error(`❌ Failed to execute proposal ${proposalId}:`, error);
      throw error;
    }
  });

// Task to check proposal status
task('governor:status', 'Check proposal status')
  .addParam('proposalId', 'The proposal ID to check')
  .setAction(async (taskArgs, hre) => {
    const proposalId = parseInt(taskArgs.proposalId);
    
    // Create deployment manager
    await createDeploymentManager(hre);
    
    try {
      const result = await getProposalStatusTask(hre, proposalId);
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
  .addFlag('batchdeploy', 'batch deploy mode')
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    const newImplementationAddress = taskArgs.implementation;
    const deployment = taskArgs.deployment;
    const batchdeploy = taskArgs.batchdeploy;
    await createDeploymentManager(hre, deployment, { batchdeploy });
    
    try {
      const result = await proposeCometUpgradeTask(hre, newImplementationAddress);
      return result;
    } catch (error) {
      console.error(`❌ Failed to propose Comet upgrade:`, error);
      throw error;
    }
  }); 

// Task to propose funding CometRewards
task('governor:propose-fund-comet-rewards', 'Propose to fund CometRewards contract with COMP tokens')
  .addParam('amount', 'The amount of COMP tokens to transfer (in wei, e.g., "1000000000000000000000" for 1000 COMP)')
  .setAction(async (taskArgs, hre) => {
    const amount = taskArgs.amount;

    await createDeploymentManager(hre);
    
    try {
      const result = await proposeFundCometRewardsTask(hre, amount);
      return result;
    } catch (error) {
      console.error(`❌ Failed to propose CometRewards funding:`, error);
      throw error;
    }
  });



// Task to propose governance update (improved version)
task('governor:propose-governance-update', 'Propose governance configuration and/or timelock delay updates')
  .addParam('deployment', 'The deployment to use')
  .addOptionalParam('admins', 'Comma-separated list of new admin addresses (optional)')
  .addOptionalParam('threshold', 'New multisig threshold (optional)')
  .addOptionalParam('timelockDelay', 'New timelock delay in seconds (optional)')
  .setAction(async (taskArgs, hre) => {
    const adminsParam = taskArgs.admins;
    const threshold = taskArgs.threshold ? parseInt(taskArgs.threshold) : undefined;
    const deployment = taskArgs.deployment;
    const timelockDelay = taskArgs.timelockDelay ? parseInt(taskArgs.timelockDelay) : undefined;
    
    await createDeploymentManager(hre, deployment);
    
    // Parse admin addresses if provided
    let admins: string[] | undefined;
    if (adminsParam) {
      admins = adminsParam.split(',').map((addr: string) => addr.trim());
    }
    
    // Validate that at least one update is provided
    if (!admins && !threshold && !timelockDelay) {
      throw new Error('❌ At least one update must be provided (admins/threshold or timelockDelay)');
    }
    
    // Validate that if admins are provided, threshold is also provided
    if (admins && !threshold) {
      throw new Error('❌ Threshold must be provided when admins are specified');
    }
    
    // Validate that if threshold is provided, admins are also provided
    if (threshold && !admins) {
      throw new Error('❌ Admins must be provided when threshold is specified');
    }
    
    try {
      const result = await proposeGovernanceUpdateTask(hre, admins, threshold, timelockDelay);
      return result;
    } catch (error) {
      console.error(`❌ Failed to propose governance update:`, error);
      throw error;
    }
  }); 

// Task to execute batch proposals using proposal stack
task('governor:execute-batch-proposal', 'Execute a batch proposal from the proposal stack')
  .addOptionalParam('deployment', 'The deployment to use (defaults to infrastructure)')
  .addOptionalParam('description', 'Optional description override for the proposal')
  .setAction(async (taskArgs, hre) => {
    const deployment = taskArgs.deployment || '_infrastructure';
    
    // Create deployment manager
    const dm = await createDeploymentManager(hre, deployment);
    
    // Create proposal manager
    const proposalManager = createProposalManager(hre.network.name);
    
    console.log(`Executing batch proposal from proposal stack...`);
    
    // Check if proposal stack has actions
    const hasActions = await proposalManager.hasActions();
    if (!hasActions) {
      throw new Error('❌ No actions found in proposal stack. Please add actions first.');
    }
    
    const actionCount = await proposalManager.getActionCount();
    console.log(`Found ${actionCount} actions in proposal stack`);
    
    try {
      // Execute the proposal
      const result = await proposalManager.executeProposal(dm);
      
      console.log(`✅ Batch proposal executed successfully!`);
      console.log(`📋 Proposal ID: ${result.proposalId}`);
      console.log(`🔗 Transaction Hash: ${result.transactionHash}`);
      console.log(`📝 Description: ${result.description}`);
      console.log(`🎯 Actions: ${result.targets.length} targets`);
      
      return result;
    } catch (error) {
      console.error(`❌ Failed to execute batch proposal:`, error);
      throw error;
    }
  });

// Task to add actions to the proposal stack
task('governor:add-to-stack', 'Add actions to the proposal stack')
  .addOptionalParam('deployment', 'The deployment to use (defaults to infrastructure)')
  .addOptionalParam('stackFile', 'Path to a JSON file containing actions to add')
  .setAction(async (taskArgs, hre) => {
    // Create proposal manager
    const proposalManager = createProposalManager(hre.network.name);
    
    console.log(`Managing proposal stack...`);
    
    if (taskArgs.stackFile) {
      // Load actions from file
      console.log(`Loading actions from file: ${taskArgs.stackFile}`);
      // TODO: Implement file loading functionality
      console.log('⚠️  File loading not yet implemented. Please use the ProposalManager API directly.');
    } else {
      console.log('ℹ️  No stack file provided. Use the ProposalManager API to add actions programmatically.');
      console.log('📁 Proposal stack location:', proposalManager.getProposalStackPath());
    }
    
    // Show current stack status
    const hasActions = await proposalManager.hasActions();
    const actionCount = await proposalManager.getActionCount();
    
    console.log(`📊 Current proposal stack status:`);
    console.log(`   Actions: ${hasActions ? actionCount : 0}`);
    console.log(`   Stack file: ${proposalManager.getProposalStackPath()}`);
    
    if (hasActions) {
      console.log(`✅ Proposal stack is ready for batch execution`);
    } else {
      console.log(`⚠️  Proposal stack is empty. Add actions before executing.`);
    }
    
    return {
      hasActions,
      actionCount,
      stackPath: proposalManager.getProposalStackPath()
    };
  });

// Task to clear the proposal stack
task('governor:clear-stack', 'Clear all actions from the proposal stack')
  .setAction(async (taskArgs, hre) => {
    // Create proposal manager
    const proposalManager = createProposalManager(hre.network.name);
    
    try {
      // Clear the proposal stack
      await proposalManager.clearProposalStack();
      
      console.log(`✅ Proposal stack cleared successfully!`);
    } catch (error) {
      console.error(`❌ Failed to clear proposal stack:`, error);
      throw error;
    }
  });