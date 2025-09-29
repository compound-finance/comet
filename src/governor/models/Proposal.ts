import { BigNumberish } from 'ethers';

/**
 * Core proposal data structure
 */
export interface Proposal {
  id?: string;
  targets: string[];
  values: BigNumberish[];
  calldatas: string[];
  description: string;
  proposer?: string;
  eta?: number;
  canceled?: boolean;
  executed?: boolean;
  state?: number;
  metadata?: {
    [key: string]: any;
  };
}

/**
 * Proposal creation result
 */
export interface ProposalResult {
  proposalId?: string;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  proposal?: Proposal;
  // Batch mode specific fields
  batchMode: boolean;
  actionsAdded?: number;
  description: string;
}

/**
 * Proposal state enumeration
 */
export enum ProposalState {
  Pending = 0,
  Active = 1,
  Canceled = 2,
  Defeated = 3,
  Succeeded = 4,
  Queued = 5,
  Expired = 6,
  Executed = 7
}

/**
 * Proposal approval information
 */
export interface ProposalApprovalInfo {
  currentApprovals: number;
  requiredApprovals: number;
  hasEnoughApprovals: boolean;
  state: ProposalState;
  totalAdmins: number;
}
