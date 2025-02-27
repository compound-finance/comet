import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumber, Contract, Event, EventFilter } from 'ethers';
import { erc20 } from './ERC20';
import { DeploymentManager } from '../../deployment_manager/DeploymentManager';

const getMaxEntry = (args: [string, BigNumber][]) =>
  args.reduce(([a1, m], [a2, e]) => (m.gte(e) == true ? [a1, m] : [a2, e]));

interface SourceTokenParameters {
  dm: DeploymentManager;
  amount: number | bigint;
  asset: string;
  address: string;
  blacklist: string[];
  blockNumber?: number;
}

export async function fetchQuery(
  contract: Contract,
  filter: EventFilter,
  fromBlock: number,
  toBlock: number,
  originalBlock: number,
  MAX_SEARCH_BLOCKS = 40000,
  BLOCK_SPAN = 2048
): Promise<{ recentLogs: Event[], blocksDelta: number }> {
  if (originalBlock - fromBlock > MAX_SEARCH_BLOCKS) {
    throw(new Error(`No events found within ${MAX_SEARCH_BLOCKS} blocks for ${contract.address}`));
  }
  try {
    const res = await contract.queryFilter(filter, fromBlock, toBlock);
    if (res.length > 0) {
      return { recentLogs: res, blocksDelta: toBlock - fromBlock };
    } else {
      const nextToBlock = fromBlock;
      const nextFrom = fromBlock - BLOCK_SPAN;
      if (nextFrom < 0) {
        throw(new Error('No events found by chain genesis'));
      }
      return fetchQuery(contract, filter, nextFrom, nextToBlock, originalBlock);
    }
  } catch (err) {
    if (err.message.includes('query returned more')) {
      const midBlock = (fromBlock + toBlock) / 2;
      return fetchQuery(contract, filter, midBlock, toBlock, originalBlock);
    } else {
      throw(err);
    }
  }
}

/// ETH balance is used for transfer out when amount is negative
export async function sourceTokens({
  dm,
  amount: amount_,
  asset,
  address,
  blacklist,
  blockNumber,
}: SourceTokenParameters) {
  let amount = BigNumber.from(amount_);
  if (amount.isZero()) {
    return;
  } else if (amount.isNegative()) {
    await removeTokens(dm, amount.abs(), asset, address);
  } else {
    await addTokens(dm, amount, asset, address, [address].concat(blacklist), blockNumber);
  }
}

async function removeTokens(
  dm: DeploymentManager,
  amount: BigNumber,
  asset: string,
  address: string
) {
  let ethers = dm.hre.ethers;
  await dm.hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });
  let signer = await dm.getSigner(address);
  let tokenContract = new ethers.Contract(asset, erc20, signer);
  let currentBalance = await tokenContract.balanceOf(address);
  if (currentBalance.lt(amount)) throw 'Error: Insufficient address balance';
  await dm.hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
  await tokenContract.transfer('0x0000000000000000000000000000000000000001', amount, { gasPrice: 0 });
  await dm.hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [address],
  });
}

async function addTokens(
  dm: DeploymentManager,
  amount: BigNumber,
  asset: string,
  address: string,
  blacklist: string[],
  block?: number,
  offsetBlocks?: number,
  MAX_SEARCH_BLOCKS = 40000,
  BLOCK_SPAN = 2048
) {
  // XXX we should really take min of current balance and amount and transfer that much
  let ethers = dm.hre.ethers;
  block = block ?? (await ethers.provider.getBlockNumber());
  let tokenContract = new ethers.Contract(asset, erc20, ethers.provider);
  let filter = tokenContract.filters.Transfer();
  let { recentLogs, blocksDelta } = await fetchQuery(
    tokenContract,
    filter,
    block - BLOCK_SPAN - (offsetBlocks ?? 0),
    block - (offsetBlocks ?? 0),
    block,
    MAX_SEARCH_BLOCKS,
    BLOCK_SPAN
  );
  let holder = await searchLogs(recentLogs, amount, tokenContract, ethers, blacklist);
  if (holder) {
    await dm.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [holder],
    });
    let impersonatedSigner = await dm.getSigner(holder);
    let impersonatedProviderTokenContract = tokenContract.connect(impersonatedSigner);
    await dm.hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
    await impersonatedProviderTokenContract.transfer(address, amount, { gasPrice: 0 });
    await dm.hre.network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [holder],
    });
  } else {
    if ((offsetBlocks ?? 0) > MAX_SEARCH_BLOCKS) throw "Error: Couldn't find sufficient tokens";
    await addTokens(dm, amount, asset, address, blacklist, block, (offsetBlocks ?? 0) + blocksDelta);
  }
}

async function searchLogs(
  recentLogs: Event[],
  amount: BigNumber,
  tokenContract: Contract,
  ethers: HardhatRuntimeEnvironment['ethers'],
  blacklist?: string[],
  logOffset?: number,
): Promise<string | null> {
  let addresses = new Set<string>();
  if ((logOffset ?? 0) >= recentLogs.length) return null;
  recentLogs.slice(logOffset ?? 0, (logOffset ?? 0) + 20).map((log) => {
    addresses.add(log.args![0]);
    addresses.add(log.args![1]);
  });
  let balancesDict = new Map<string, BigNumber>();
  await Promise.all([
    ...Array.from(addresses).map(async (address) => {
      balancesDict.set(address, await tokenContract.balanceOf(address));
    })
  ]);
  for (let address of blacklist) {
    balancesDict.delete(address);
  }
  let balances = Array.from(balancesDict.entries());
  if (balances.length > 0) {
    let max = getMaxEntry(balances);
    if (max[1].gte(amount)) {
      return max[0];
    }
  }
  return searchLogs(recentLogs, amount, tokenContract, ethers, blacklist, (logOffset ?? 0) + 20);
}
