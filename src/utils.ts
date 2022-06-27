import { BigNumberish } from 'ethers';
import { GovernorSimple } from '../build/types';

// Instantly executes some actions through the governance proposal process
// Note: `governor` must be connected to an `admin` signer
export async function fastGovernanceExecute(governor: GovernorSimple, targets: string[], values: BigNumberish[], signatures: string[], calldatas: string[]) {
  let tx = await (await governor.propose(targets, values, signatures, calldatas, 'FastExecuteProposal')).wait();
  let event = tx.events.find(event => event.event === 'ProposalCreated');
  let [proposalId] = event.args;

  await governor.queue(proposalId);
  await governor.execute(proposalId);
}

export function extractCalldata(txnData: string): string {
  // Remove the first 4 bytes (function selector) of the transaction data
  return '0x' + txnData.slice(10);
}