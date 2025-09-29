import { BigNumberish } from 'ethers';

/**
 * Execution types for different proposal categories
 */
export type ExecutionType = 
  | 'comet-impl-in-configuration'
  | 'comet-upgrade'
  | 'governance-update'
  | 'comet-reward-funding';

/**
 * Proposal execution result
 */
export interface ExecutionResult {
  proposalId: string;
  transactionHash: string;
  blockNumber: number;
  gasUsed: string;
  targets: string[];
  values: BigNumberish[];
  calldatas: string[];
  description: string;
  extractedLogs?: any;
}

/**
 * Queue result for proposals
 */
export interface QueueResult {
  proposalId: number;
  transactionHash?: string;
  eta: number;
  executionTime: Date;
  timelockDelay: number;
  alreadyQueued?: boolean;
}

/**
 * Proposal timing information
 */
export interface ProposalTiming {
  eta: number;
  executionTime: Date;
  timelockDelay: number;
  timeUntilExecution: number; // in seconds
}

/**
 * Extracted log data from transaction execution
 */
export interface ExtractedLogs {
  txHash: string;
  blockNumber: number;
  logsCount: number;
  executionType: ExecutionType;
  parsedLogs: {
    [key: string]: any;
  };
}
