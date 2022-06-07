import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumber, Contract, Event, EventFilter } from 'ethers';
import { erc20 } from './ERC20';

let getMaxEntry = (args: [string, BigNumber][]) =>
  args.reduce(([a1, m], [a2, e]) => (m.gte(e) == true ? [a1, m] : [a2, e]));

interface SourceTokenParameters {
  hre: HardhatRuntimeEnvironment;
  amount: number | bigint;
  asset: string;
  address: string;
  blacklist: string[] | undefined;
}

/// ETH balance is used for transfer out when amount is negative
export async function sourceTokens({
  hre,
  amount: amount_,
  asset,
  address,
  blacklist,
}: SourceTokenParameters) {
  let amount = BigNumber.from(amount_);

  if (amount.isNegative()) {
    await removeTokens(hre, amount.abs(), asset, address);
  } else {
    await addTokens(hre, amount, asset, address, blacklist);
  }
}

async function removeTokens(
  hre: HardhatRuntimeEnvironment,
  amount: BigNumber,
  asset: string,
  address: string
) {
  let ethers = hre.ethers;
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });
  let signer = await ethers.getSigner(address);
  let tokenContract = new ethers.Contract(asset, erc20, signer);
  let currentBalance = await tokenContract.balanceOf(address);
  if (currentBalance.lt(amount)) throw 'Error: Insufficient address balance';
  await tokenContract.transfer('0x0000000000000000000000000000000000000000', amount);
  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [address],
  });
}

// XXX make sure we don't source tokens directly from the protocol
async function addTokens(
  hre: HardhatRuntimeEnvironment,
  amount: BigNumber,
  asset: string,
  address: string,
  blacklist?: string[],
  block?: number,
  offsetBlocks?: number
) {
  let ethers = hre.ethers;
  block = block ?? (await ethers.provider.getBlockNumber());
  let tokenContract = new ethers.Contract(asset, erc20, ethers.provider);
  let filter = tokenContract.filters.Transfer();
  let { recentLogs, blocksDelta, err } = await fetchQuery(
    tokenContract,
    filter,
    block - 1000 - (offsetBlocks ?? 0),
    block - (offsetBlocks ?? 0)
  );
  if (err) {
    throw err;
  }
  let holder = await searchLogs(recentLogs, amount, tokenContract, ethers, blacklist);
  if (holder) {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [holder],
    });
    let impersonatedSigner = await ethers.getSigner(holder);
    let impersonatedProviderTokenContract = tokenContract.connect(impersonatedSigner);
    await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
    await impersonatedProviderTokenContract.transfer(address, amount, { gasPrice: 0 });
    await hre.network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [holder],
    });
  } else {
    if ((offsetBlocks ?? 0) > 40000) throw "Error: Couldn't find sufficient tokens";
    await addTokens(hre, amount, asset, address, blacklist, block, (offsetBlocks ?? 0) + blocksDelta);
  }
}

async function fetchQuery(
  contract: Contract,
  filter: EventFilter,
  fromBlock: number,
  toBlock: number
): Promise<{ recentLogs?: Event[], blocksDelta?: number, err?: Error }> {
  try {
    let res = await contract.queryFilter(filter, fromBlock, toBlock);
    if (res.length > 0) {
      return { recentLogs: res, blocksDelta: toBlock - fromBlock };
    } else {
      let nextToBlock = fromBlock;
      let nextFrom = fromBlock - 1000;
      if (nextFrom < 0) {
        return { err: new Error('No events found by chain genesis') };
      }
      return await fetchQuery(contract, filter, nextFrom, nextToBlock);
    }
  } catch (err) {
    if (err.message.includes('query returned more')) {
      let midBlock = (fromBlock + toBlock) / 2;
      return await fetchQuery(contract, filter, midBlock, toBlock);
    } else {
      return { err };
    }
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
