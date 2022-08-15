import { Contract, Event, EventFilter } from 'ethers';

export async function fetchQuery(
  contract: Contract,
  filter: EventFilter,
  fromBlock: number,
  toBlock: number,
  originalBlock: number,
  MAX_SEARCH_BLOCKS = 40000,
  BLOCK_SPAN = 1000
): Promise<{ recentLogs?: Event[], blocksDelta?: number, err?: Error }> {
  if (originalBlock - fromBlock > MAX_SEARCH_BLOCKS) {
    return { err: new Error(`No events found within ${MAX_SEARCH_BLOCKS} blocks for ${contract.address}`) };
  }
  try {
    let res = await contract.queryFilter(filter, fromBlock, toBlock);
    if (res.length > 0) {
      return { recentLogs: res, blocksDelta: toBlock - fromBlock };
    } else {
      let nextToBlock = fromBlock;
      let nextFrom = fromBlock - BLOCK_SPAN;
      if (nextFrom < 0) {
        return { err: new Error('No events found by chain genesis') };
      }
      return await fetchQuery(contract, filter, nextFrom, nextToBlock, originalBlock);
    }
  } catch (err) {
    if (err.message.includes('query returned more')) {
      let midBlock = (fromBlock + toBlock) / 2;
      return await fetchQuery(contract, filter, midBlock, toBlock, originalBlock);
    } else {
      return { err };
    }
  }
}