import { BigNumberish } from 'ethers';
import { GovernorSimple } from '../build/types';

// Instantly executes some actions through the governance proposal process
// Note: `governor` must be connected to an `admin` signer
export async function fastGovernanceExecute(governor: GovernorSimple, targets: string[], values: BigNumberish[], signatures: string[], calldatas: string[]) {
  let tx = await (await governor.propose(targets, values, signatures, calldatas, 'FastExecuteProposal')).wait();
  let event = tx.events.find(event => event.event === 'ProposalCreated');
  let [proposalId] = event.args;

  await (await governor.queue(proposalId)).wait();
  await (await governor.execute(proposalId)).wait();
}

export function extractCalldata(txnData: string): string {
  // Remove the first 4 bytes (function selector) of the transaction data
  return '0x' + txnData.slice(10);
}

export function shouldDeploy(deployAll: boolean, deployContract: boolean): boolean {
  if (deployContract !== undefined) {
    return deployContract;
  }
  return deployAll;
}