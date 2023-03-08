import { BigNumber } from 'ethers';

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

export type OpenProposal = { id: BigNumber, startBlock: BigNumber, endBlock: BigNumber };
export type OpenBridgedProposal = { id: BigNumber, eta: BigNumber };
