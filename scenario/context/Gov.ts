export { IGovernorBravo } from '../../build/types';

export enum ProposalState {
  Pending,
  Active,
  Canceled,
  Defeated,
  Succeeded,
  Queued,
  Expired,
  Executed
}

export type OpenProposal = { id: number, startBlock: number, endBlock: number };
