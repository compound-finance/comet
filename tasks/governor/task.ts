import { task } from "hardhat/config";
import { DeploymentManager } from "../../plugins/deployment_manager";
import approveProposal from "../../src/governor/ApproveProposal";
import queueProposal from "../../src/governor/QueueProposal";
import executeProposal from "../../src/governor/ExecuteProposal";
import getProposalStatus from "../../src/governor/GetProposalStatus";
import proposeCometUpgradeTask from "../../src/governor/ProposeCometUpgrade";
import fundCometRewardsTask from "../../src/governor/FundCometRewards";

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
task("governor:approve", "Approve a proposal")
  .addParam("proposalId", "The proposal ID to approve")
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    await createDeploymentManager(hre);
    
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
task("governor:queue", "Queue a proposal")
  .addParam("proposalId", "The proposal ID to queue")
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    await createDeploymentManager(hre);
    
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
task("governor:execute", "Execute a proposal")
  .addParam("proposalId", "The proposal ID to execute")
  .addParam("executionType", "The execution type (comet-impl-in-configuration, comet-upgrade)")
  .setAction(async (taskArgs, hre) => {

    await createDeploymentManager(hre);
    
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
task("governor:status", "Check proposal status")
  .addParam("proposalId", "The proposal ID to check")
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    await createDeploymentManager(hre);
    
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
task("governor:propose-upgrade", "Propose a Comet implementation upgrade")
  .addParam("implementation", "The new implementation address")
  .addParam("deployment", "The deployment to use")
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
task("governor:propose-fund-comet-rewards", "Propose to fund CometRewards contract with COMP tokens")
  .addParam("amount", "The amount of COMP tokens to transfer (in wei, e.g., '1000000000000000000000' for 1000 COMP)")
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