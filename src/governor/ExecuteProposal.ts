import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'ethers';

export default async function executeProposal(hre: HardhatRuntimeEnvironment, proposalId: number, executionType: string) {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Executing proposal ${proposalId} with execution type: ${executionType || 'default'}...`);
  
  try {
    const result = await executeCometProposal(deploymentManager, proposalId);
    
    console.log(`✅ Proposal ${proposalId} executed successfully!`);
    console.log(`   Transaction hash: ${result.tx.transactionHash}`);
    
    // Extract logs based on execution type
    if (result.tx.transactionHash) {
      const extractedLogs = await extractLogsFromTransaction(deploymentManager, result.tx.transactionHash, executionType);
      result.extractedLogs = extractedLogs;
      
      // Log the extracted logs
      console.log('\n📋 Extracted Logs:');
      console.log(JSON.stringify(extractedLogs, null, 2));
    }
    
    return result;
  } catch (error) {
    trace(`❌ Failed to execute proposal ${proposalId}: ${error}`);
    throw error;
  }
} 

async function executeCometProposal(
  deploymentManager: DeploymentManager,
  proposalId: number,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const trace = deploymentManager.tracer();
  
  trace(`Executing proposal ${proposalId} by admin ${admin.address}`);
  
  const tx = await governorContract.connect(admin).execute(proposalId);
  const receipt = await tx.wait();
  
  trace(`Proposal ${proposalId} executed! Transaction hash: ${receipt.transactionHash}`);
  
  return { proposalId, tx: receipt };
}

/**
 * Extracts and analyzes logs from a transaction receipt
 * @param deploymentManager The deployment manager instance
 * @param txHash The transaction hash to analyze
 * @param executionType The type of execution to determine which logs to extract
 * @returns Object containing extracted log data
 */
async function extractLogsFromTransaction(
  deploymentManager: DeploymentManager,
  txHash: string,
  executionType?: string
): Promise<any> {
  const provider = deploymentManager.hre.ethers.provider;
  const trace = deploymentManager.tracer();
  
  trace(`Extracting logs from transaction: ${txHash} with execution type: ${executionType || 'default'}`);
  
  try {
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      throw new Error(`Transaction receipt not found for hash: ${txHash}`);
    }
    
    trace(`Transaction receipt found. Logs count: ${receipt.logs.length}`);
    
    // Base structure for log analysis
    const extractedLogs = {
      txHash,
      blockNumber: receipt.blockNumber,
      logsCount: receipt.logs.length,
      executionType: executionType || 'default',
      logs: receipt.logs,
      parsedLogs: {} as any
    };
    
    // Parse logs based on execution type
    switch (executionType) {
      case 'comet-impl-in-configuration':        
        const cometDeployedData = extractCometDeployedEvent(receipt, trace);
        if (cometDeployedData) {
          extractedLogs.parsedLogs.cometDeployed = cometDeployedData;
        }
        break;
        
      case 'comet-upgrade':
        // TODO: Add specific log parsing for reward configuration execution
        trace('Parsing logs for reward configuration execution...');
        break;
        
      default:
        // Default log parsing
        trace('Parsing logs with default strategy...');
        break;
    }
    
    trace(`Log extraction completed for transaction: ${txHash}`);
    
    return extractedLogs;
    
  } catch (error) {
    trace(`❌ Failed to extract logs from transaction ${txHash}: ${error}`);
    throw error;
  }
}

/**
 * Extracts CometDeployed event from transaction logs
 * @param receipt Transaction receipt containing logs
 * @param trace Tracer function for logging
 * @returns Parsed CometDeployed event data or null if not found
 */
function extractCometDeployedEvent(receipt: any, trace: any): any {
  trace('Parsing logs for Comet implementation deployment...');
  // Create interface for Configurator contract to parse CometDeployed event
  const configuratorInterface = new ethers.utils.Interface([
    'event CometDeployed(address indexed cometProxy, address indexed newComet)'
  ]);
  
  // Look for CometDeployed events in the logs
  const cometDeployedEvents = receipt.logs
    .map((log: any) => {
      try {
        return configuratorInterface.parseLog(log);
      } catch (error) {
        return null; // Not a CometDeployed event
      }
    })
    .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'CometDeployed');
  
  if (cometDeployedEvents.length > 0) {
    const cometDeployedEvent = cometDeployedEvents[0];
    const cometProxy = cometDeployedEvent.args.cometProxy;
    const newComet = cometDeployedEvent.args.newComet;
    
    trace(`Found CometDeployed event: proxy=${cometProxy}, newComet=${newComet}`);
    
    return {
      cometProxy,
      newComet,
      eventName: 'CometDeployed'
    };
  } else {
    trace('No CometDeployed event found in transaction logs');
    return null;
  }
}