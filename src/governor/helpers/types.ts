import { BigNumberish, Contract } from 'ethers';

/**
 * Action that targets a specific contract instance
 */
export interface ContractAction {
  contract: Contract;
  value?: BigNumberish;
  signature: string;
  args: any[];
}

/**
 * Action that targets a specific address with pre-encoded calldata
 */
export interface TargetAction {
  target: string;
  value?: BigNumberish;
  calldata: string;
}

/**
 * Union type for proposal actions
 */
export type ProposalAction = ContractAction | TargetAction;

/**
 * Complete proposal structure with all necessary data
 */
export interface ProposalData {
  targets: string[];
  values: BigNumberish[];
  calldatas: string[];
  description: string;
  governor?: string;
  metadata?: {
    [key: string]: any;
  };
}

/**
 * Proposal action stored in the proposal stack file
 */
export interface ProposalStackAction {
  id: string;
  target: string;
  value?: BigNumberish;
  calldata?: string;
  args?: any[];
  description?: string;
}

/**
 * Proposal stack file structure
 */
export interface ProposalStack {
  actions: ProposalStackAction[];
  description?: string;
  metadata?: {
    [key: string]: any;
  };
}

/**
 * Proposal execution result
 */
export interface ProposalExecutionResult {
  proposalId: string;
  transactionHash: string;
  targets: string[];
  values: BigNumberish[];
  calldatas: string[];
  description: string;
}
