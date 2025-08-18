import { task } from "hardhat/config";
import { DeploymentManager } from "../../plugins/deployment_manager";
import approveProposal from "../../src/governor/ApproveProposal";
import queueProposal from "../../src/governor/QueueProposal";
import executeProposal from "../../src/governor/ExecuteProposal";
import getProposalStatus from "../../src/governor/GetProposalStatus";

// Helper function to create deployment manager
async function createDeploymentManager(hre: any, deployment: string) {
  const network = hre.network.name;
  const dm = new DeploymentManager(
    network,
    deployment,
    hre,
    {
      writeCacheToDisk: true,
      verificationStrategy: 'lazy',
    }
  );
  await dm.spider();
  
  // Load infrastructure contracts (governor, timelock, etc.)
  const infrastructureSpider = await dm.spiderOther(network, '_infrastructure');

  for (const [alias, contract] of infrastructureSpider.contracts) {
    await dm.putAlias(alias, contract);
  }
  
  // Attach deployment manager to hre
  (hre as any).deploymentManager = dm;
  return dm;
}

// Task to approve a proposal
task("governor:approve", "Approve a proposal")
  .addParam("proposalId", "The proposal ID to approve")
  .addOptionalParam("deployment", "The deployment to use", "dai")
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    await createDeploymentManager(hre, taskArgs.deployment);
    
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
  .addOptionalParam("deployment", "The deployment to use", "dai")
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    await createDeploymentManager(hre, taskArgs.deployment);
    
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
  .addOptionalParam("deployment", "The deployment to use", "dai")
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    await createDeploymentManager(hre, taskArgs.deployment);
    
    const proposalId = parseInt(taskArgs.proposalId);
    
    console.log(`Executing proposal ${proposalId}...`);
    
    try {
      const result = await executeProposal(hre, proposalId);
      return result;
    } catch (error) {
      console.error(`❌ Failed to execute proposal ${proposalId}:`, error);
      throw error;
    }
  });

// Task to check proposal status
task("governor:status", "Check proposal status")
  .addParam("proposalId", "The proposal ID to check")
  .addOptionalParam("deployment", "The deployment to use", "dai")
  .setAction(async (taskArgs, hre) => {
    // Create deployment manager
    await createDeploymentManager(hre, taskArgs.deployment);
    
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