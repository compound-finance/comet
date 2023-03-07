export { BaseBridgeReceiver, IGovernorBravo } from '../../build/types';

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

export enum BridgedProposalState {
  Queued,
  Expired,
  Executed
}

export type OpenProposal = { id: number, startBlock: number, endBlock: number };
export type OpenBridgedProposal = { id: number, eta: number };
