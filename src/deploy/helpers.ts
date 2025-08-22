import { Contract } from 'ethers';

/**
 * Extracts proposal ID from ProposalCreated event in transaction logs
 * @param governorContract The governor contract instance
 * @param receipt The transaction receipt containing logs
 * @returns The proposal ID if found, null otherwise
 */
export function extractProposalIdFromLogs(
  governorContract: Contract,
  receipt: any
): number | null {
  // Find ProposalCreated event in logs
  const proposalCreatedEvent = receipt.logs.find((log: any) => {
    try {
      const parsedLog = governorContract.interface.parseLog(log);
      return parsedLog.name === 'ProposalCreated';
    } catch {
      return false;
    }
  });
  if (proposalCreatedEvent) {
    const parsedLog = governorContract.interface.parseLog(proposalCreatedEvent);
    return parsedLog.args.proposalId.toNumber();
  }

  return null;
} 