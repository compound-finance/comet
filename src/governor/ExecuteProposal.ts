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
      parsedLogs: {} as any
    };
    
    // Parse logs based on execution type
    switch (executionType) {
      case 'comet-impl-in-configuration': {
        const cometDeployedData = extractCometDeployedEvent(receipt, trace);
        if (cometDeployedData) {
          extractedLogs.parsedLogs.cometsDeployed = cometDeployedData;
        }
        break;
      }
      case 'comet-upgrade':
        trace('Parsing logs for comet upgrade execution...');
        break;

      case 'comet-reward-funding': {
        trace('Parsing logs for comet reward funding execution...');
        const transferData = extractTokenTransferEvent(receipt, trace);
        if (transferData) {
          extractedLogs.parsedLogs.tokenTransfer = transferData;
        }
        break;
      }
      case 'governance-config': {
        trace('Parsing logs for governance configuration change execution...');
        const governanceConfigData = extractGovernanceConfigEvent(receipt, trace);
        if (governanceConfigData) {
          extractedLogs.parsedLogs.governanceConfig = governanceConfigData;
        }
        break;
      }
      case 'timelock-delay-change': {
        trace('Parsing logs for timelock delay change execution...');
        const newDelayData = extractNewDelayEvent(receipt, trace);
        if (newDelayData) {
          extractedLogs.parsedLogs.newDelay = newDelayData;
        }
        break;
      }
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
  
  const cometsDeployed = [];
  for (const cometDeployedEvent of cometDeployedEvents) {
    const cometProxy = cometDeployedEvent.args.cometProxy;
    const newComet = cometDeployedEvent.args.newComet;

    trace(`Found CometDeployed event: proxy=${cometProxy}, newComet=${newComet}`);
    
    cometsDeployed.push({
      cometProxy,
      newComet,
      eventName: 'CometDeployed'
    });
  }
  if (cometsDeployed.length === 0) {
    trace('No CometDeployed event found in transaction logs');
  }

  return cometsDeployed;
}

/**
 * Extracts Transfer event from COMP token transaction logs
 * @param receipt Transaction receipt containing logs
 * @param trace Tracer function for logging
 * @returns Parsed Transfer event data or null if not found
 */
function extractTokenTransferEvent(receipt: any, trace: any): any {
  trace('Parsing logs for COMP token transfer...');
  // Create interface for COMP token to parse Transfer event
  const compInterface = new ethers.utils.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 amount)'
  ]);
  
  // Look for Transfer events in the logs
  const transferEvents = receipt.logs
    .map((log: any) => {
      try {
        return compInterface.parseLog(log);
      } catch (error) {
        return null; // Not a Transfer event
      }
    })
    .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'Transfer');
  
  if (transferEvents.length > 0) {
    const transferEvent = transferEvents[0];
    const from = transferEvent.args.from;
    const to = transferEvent.args.to;
    const amount = transferEvent.args.amount;
    
    trace(`Found Transfer event: from=${from}, to=${to}, amount=${amount}`);
    
    return {
      from,
      to,
      amount: amount.toString(),
      eventName: 'Transfer'
    };
  } else {
    trace('No Transfer event found in transaction logs');
    return null;
  }
}

/**
 * Extracts GovernorAdminChanged events from governance configuration change transaction logs
 * @param receipt Transaction receipt containing logs
 * @param trace Tracer function for logging
 * @returns Parsed governance configuration change data or null if not found
 */
function extractGovernanceConfigEvent(receipt: any, trace: any): any {
  trace('Parsing logs for governance configuration change...');
  // Create interface for CustomGovernor to parse GovernanceConfigSet event
  const governorInterface = new ethers.utils.Interface([
    'event GovernanceConfigSet(address[] admins, uint threshold)'
  ]);
  
  // Look for GovernanceConfigSet events in the logs
  const governanceConfigEvents = receipt.logs
    .map((log: any) => {
      try {
        return governorInterface.parseLog(log);
      } catch (error) {
        return null; // Not a GovernanceConfigSet event
      }
    })
    .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'GovernanceConfigSet');
  
  if (governanceConfigEvents.length > 0) {
    const governanceConfigEvent = governanceConfigEvents[0];
    const newAdmins = governanceConfigEvent.args.admins;
    const newThreshold = governanceConfigEvent.args.threshold;
    
    trace(`Found GovernanceConfigSet event`);
    trace(`New admins: ${newAdmins.join(', ')}`);
    trace(`New threshold: ${newThreshold}`);
    
    return {
      newAdmins,
      newThreshold,
      totalAdmins: newAdmins.length,
      eventName: 'GovernanceConfigSet'
    };
  } else {
    trace('No GovernanceConfigSet events found in transaction logs');
    return null;
  }
}
  
/*
 * Extracts NewDelay event from timelock transaction logs
 * @param receipt Transaction receipt containing logs
 * @param trace Tracer function for logging
 * @returns Parsed NewDelay event data or null if not found
 */
function extractNewDelayEvent(receipt: any, trace: any): any {
  trace('Parsing logs for timelock delay change...');
  
  // Debug: Log all logs to see what we're working with
  trace(`Total logs in transaction: ${receipt.logs.length}`);
  
  // Create interface for Timelock contract to parse NewDelay event
  const timelockInterface = new ethers.utils.Interface([
    'event NewDelay(uint indexed newDelay)'
  ]);
  
  // Look for NewDelay events in the logs
  const newDelayEvents = receipt.logs
    .map((log: any) => {
      try {
        const parsed = timelockInterface.parseLog(log);
        trace(`Successfully parsed log: ${parsed.name}`);
        return parsed;
      } catch (error) {
        return null;
      }
    })
    .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'NewDelay');
  
  // If still no events found, log all logs for debugging
  if (newDelayEvents.length === 0) {
    trace('No NewDelay events found, logging all available logs for debugging...');
    
    // Log all log topics and data for debugging
    receipt.logs.forEach((log: any, index: number) => {
      trace(`Log ${index}: topic0=${log.topics[0]}, data=${log.data}`);
    });
  }
  
  if (newDelayEvents.length > 0) {
    const newDelayEvent = newDelayEvents[0];
    const delay = newDelayEvent.args.newDelay;
    
    trace(`Found NewDelay event: delay=${delay} seconds`);
    
    return {
      delay: delay.toString(),
      eventName: 'NewDelay',
      formattedDelay: formatDelay(delay.toString())
    };
  } else {
    trace('No NewDelay event found in transaction logs');
    return null;
  }
}

/**
 * Formats delay value in seconds to human-readable format
 * @param delaySeconds Delay value in seconds as string
 * @returns Formatted delay string
 */
function formatDelay(delaySeconds: string): string {
  const seconds = parseInt(delaySeconds);
  if (seconds < 60) {
    return `${seconds} seconds`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minutes (${seconds} seconds)`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} hours (${seconds} seconds)`;
  } else {
    const days = Math.floor(seconds / 86400);
    return `${days} days (${seconds} seconds)`;
  }
}