import { ProposalService } from './ProposalService';
import { ExecutionResult, ExecutionType, ExtractedLogs } from '../models/ExecutionResult';
import { ethers } from 'ethers';

/**
 * Service for proposal execution operations
 */
export class ExecutionService extends ProposalService {

  /**
   * Execute a proposal
   */
  async executeProposal(proposalId: number, executionType: ExecutionType): Promise<ExecutionResult> {
    const admin = await this.getAdminSigner();
    const governor = await this.getGovernor();
    
    console.log(`Executing proposal ${proposalId} by admin ${admin.address}`);
    
    const tx = await governor.connect(admin).execute(proposalId);
    const receipt = await tx.wait();
    
    console.log(`Proposal ${proposalId} executed! Transaction hash: ${receipt.transactionHash}`);
    
    // Extract logs based on execution type
    let extractedLogs: ExtractedLogs | undefined;
    if (receipt.transactionHash) {
      extractedLogs = await this.extractLogsFromTransaction(receipt.transactionHash, executionType);
      
      // Log the extracted logs
      console.log('\n📋 Extracted Logs:');
      console.log(JSON.stringify(extractedLogs, null, 2));
    }
    
    return {
      proposalId: proposalId.toString(),
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      targets: [], // These would need to be extracted from the proposal
      values: [],
      calldatas: [],
      description: '', // This would need to be extracted from the proposal
      extractedLogs
    };
  }

  /**
   * Extract and analyze logs from a transaction receipt
   */
  private async extractLogsFromTransaction(
    txHash: string,
    executionType: ExecutionType
  ): Promise<ExtractedLogs> {
    const provider = this.deploymentManager.hre.ethers.provider;
    
    console.log(`Extracting logs from transaction: ${txHash} with execution type: ${executionType}`);
    
    try {
      // Get transaction receipt
      const receipt = await provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        throw new Error(`Transaction receipt not found for hash: ${txHash}`);
      }
      
      console.log(`Transaction receipt found. Logs count: ${receipt.logs.length}`);
      
      // Base structure for log analysis
      const extractedLogs: ExtractedLogs = {
        txHash,
        blockNumber: receipt.blockNumber,
        logsCount: receipt.logs.length,
        executionType,
        parsedLogs: {}
      };
      
      // Parse logs based on execution type
      switch (executionType) {
        case 'comet-impl-in-configuration': {
          const cometDeployedData = this.extractCometDeployedEvent(receipt);
          if (cometDeployedData) {
            extractedLogs.parsedLogs.cometsDeployed = cometDeployedData;
          }
          break;
        }
        case 'comet-upgrade': {
          console.log('Parsing logs for comet upgrade execution...');
          const upgradedData = this.extractUpgradedEvent(receipt);
          if (upgradedData) {
            extractedLogs.parsedLogs.upgraded = upgradedData;
          }
          break;
        }
        case 'comet-reward-funding': {
          console.log('Parsing logs for comet reward funding execution...');
          const transferData = this.extractTokenTransferEvent(receipt);
          if (transferData) {
            extractedLogs.parsedLogs.tokenTransfer = transferData;
          }
          break;
        }
        case 'governance-update': {
          console.log('Parsing logs for governance update execution...');
          const governanceConfigData = this.extractGovernanceConfigEvent(receipt);
          const newDelayData = this.extractNewDelayEvent(receipt);
          
          if (governanceConfigData) {
            extractedLogs.parsedLogs.governanceConfig = governanceConfigData;
          }
          if (newDelayData) {
            extractedLogs.parsedLogs.newDelay = newDelayData;
          }
          break;
        }
        default:
          console.log('Parsing logs with default strategy...');
          break;
      }
      
      console.log(`Log extraction completed for transaction: ${txHash}`);
      
      return extractedLogs;
      
    } catch (error) {
      console.log(`❌ Failed to extract logs from transaction ${txHash}: ${error}`);
      throw error;
    }
  }

  /**
   * Extract CometDeployed event from transaction logs
   */
  private extractCometDeployedEvent(receipt: any): any {
    console.log('Parsing logs for Comet implementation deployment...');
    const configuratorInterface = new ethers.utils.Interface([
      'event CometDeployed(address indexed cometProxy, address indexed newComet)'
    ]);
    
    const cometDeployedEvents = receipt.logs
      .map((log: any) => {
        try {
          return configuratorInterface.parseLog(log);
        } catch (error) {
          return null;
        }
      })
      .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'CometDeployed');
    
    const cometsDeployed = [] as { cometProxy: string, newComet: string, eventName: string }[];
    for (const cometDeployedEvent of cometDeployedEvents) {
      const cometProxy = cometDeployedEvent.args.cometProxy;
      const newComet = cometDeployedEvent.args.newComet;

      console.log(`Found CometDeployed event: proxy=${cometProxy}, newComet=${newComet}`);
      
      cometsDeployed.push({
        cometProxy,
        newComet,
        eventName: 'CometDeployed'
      });
    }
    
    return cometsDeployed.length > 0 ? cometsDeployed : null;
  }

  /**
   * Extract Transfer event from COMP token transaction logs
   */
  private extractTokenTransferEvent(receipt: any): any {
    console.log('Parsing logs for COMP token transfer...');
    const compInterface = new ethers.utils.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 amount)'
    ]);
    
    const transferEvents = receipt.logs
      .map((log: any) => {
        try {
          return compInterface.parseLog(log);
        } catch (error) {
          return null;
        }
      })
      .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'Transfer');
    
    if (transferEvents.length > 0) {
      const transferEvent = transferEvents[0];
      const from = transferEvent.args.from;
      const to = transferEvent.args.to;
      const amount = transferEvent.args.amount;
      
      console.log(`Found Transfer event: from=${from}, to=${to}, amount=${amount}`);
      
      return {
        from,
        to,
        amount: amount.toString(),
        eventName: 'Transfer'
      };
    }
    
    return null;
  }

  /**
   * Extract GovernorAdminChanged events from governance configuration change transaction logs
   */
  private extractGovernanceConfigEvent(receipt: any): any {
    console.log('Parsing logs for governance configuration change...');
    const governorInterface = new ethers.utils.Interface([
      'event GovernanceConfigSet(address[] admins, uint threshold)'
    ]);
    
    const governanceConfigEvents = receipt.logs
      .map((log: any) => {
        try {
          return governorInterface.parseLog(log);
        } catch (error) {
          return null;
        }
      })
      .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'GovernanceConfigSet');
    
    if (governanceConfigEvents.length > 0) {
      const governanceConfigEvent = governanceConfigEvents[0];
      const newAdmins = governanceConfigEvent.args.admins;
      const newThreshold = governanceConfigEvent.args.threshold;
      
      console.log(`Found GovernanceConfigSet event`);
      console.log(`New admins: ${newAdmins.join(', ')}`);
      console.log(`New threshold: ${newThreshold}`);
      
      return {
        newAdmins,
        newThreshold,
        totalAdmins: newAdmins.length,
        eventName: 'GovernanceConfigSet'
      };
    }
    
    return null;
  }

  /**
   * Extract NewDelay event from timelock transaction logs
   */
  private extractNewDelayEvent(receipt: any): any {
    console.log('Parsing logs for timelock delay change...');
    
    const timelockInterface = new ethers.utils.Interface([
      'event NewDelay(uint indexed newDelay)'
    ]);
    
    const newDelayEvents = receipt.logs
      .map((log: any) => {
        try {
          const parsed = timelockInterface.parseLog(log);
          console.log(`Successfully parsed log: ${parsed.name}`);
          return parsed;
        } catch (error) {
          return null;
        }
      })
      .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'NewDelay');
    
    if (newDelayEvents.length > 0) {
      const newDelayEvent = newDelayEvents[0];
      const delay = newDelayEvent.args.newDelay;
      
      console.log(`Found NewDelay event: delay=${delay} seconds`);
      
      return {
        delay: delay.toString(),
        eventName: 'NewDelay',
        formattedDelay: this.formatDelay(delay.toString())
      };
    }
    
    return null;
  }

  /**
   * Extract Upgraded event from transaction logs
   */
  private extractUpgradedEvent(receipt: any): any {
    console.log('Parsing logs for Upgraded event...');
    
    const proxyInterface = new ethers.utils.Interface([
      'event Upgraded(address indexed implementation)'
    ]);
    
    const upgradedEvents = receipt.logs
      .map((log: any) => {
        try {
          return proxyInterface.parseLog(log);
        } catch (error) {
          return null;
        }
      })
      .filter((parsedLog: any) => parsedLog !== null && parsedLog.name === 'Upgraded');
    
    if (upgradedEvents.length > 0) {
      const upgradedEvent = upgradedEvents[0];
      const implementation = upgradedEvent.args.implementation;
      
      console.log(`Found Upgraded event: implementation=${implementation}`);
      
      return {
        implementation,
        eventName: 'Upgraded'
      };
    }
    
    return null;
  }

  /**
   * Format delay value in seconds to human-readable format
   */
  private formatDelay(delaySeconds: string): string {
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
}
