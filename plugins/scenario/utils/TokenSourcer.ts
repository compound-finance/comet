import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumber, Contract, Event, EventFilter } from 'ethers';
import { erc20 } from './ERC20';
import { DeploymentManager } from '../../deployment_manager/DeploymentManager';
import { MAX_SEARCH_BLOCKS, BLOCK_SPAN, fetchQuery } from '../../../scenario/utils';

const getMaxEntry = (args: [string, BigNumber][]) =>
  args.reduce(([a1, m], [a2, e]) => (m.gte(e) == true ? [a1, m] : [a2, e]));

interface SourceTokenParameters {
  dm: DeploymentManager;
  amount: number | bigint;
  asset: string;
  address: string;
  blacklist: string[] | undefined;
}

/// ETH balance is used for transfer out when amount is negative
export async function sourceTokens({
  dm,
  amount: amount_,
  asset,
  address,
  blacklist,
}: SourceTokenParameters) {
  let amount = BigNumber.from(amount_);

  if (amount.isZero()) {
    return;
  } else if (amount.isNegative()) {
    await removeTokens(dm, amount.abs(), asset, address);
  } else {
    await addTokens(dm, amount, asset, address, blacklist);
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
  await tokenContract.transfer('0x0000000000000000000000000000000000000001', amount);
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
  blacklist?: string[],
  block?: number,
  offsetBlocks?: number
) {
  let ethers = dm.hre.ethers;
  block = block ?? (await ethers.provider.getBlockNumber());
  let tokenContract = new ethers.Contract(asset, erc20, ethers.provider);
  let filter = tokenContract.filters.Transfer();
  let { recentLogs, blocksDelta, err } = await fetchQuery(
    tokenContract,
    filter,
    block - BLOCK_SPAN - (offsetBlocks ?? 0),
    block - (offsetBlocks ?? 0),
    block
  );
  if (err) {
    throw err;
  }
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
