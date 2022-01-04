import { HardhatRuntimeEnvironment } from 'hardhat/types';
import fs from 'fs';
import { BigNumber, Contract, Event, EventFilter } from 'ethers';

const getMaxEntry = (args: [string, BigNumber][]) =>
  args.reduce(([a1, m], [a2, e]) => (m.gte(e) == true ? [a1, m] : [a2, e]));

interface SourceTokenParameters {
  hre: HardhatRuntimeEnvironment;
  amount: BigInt;
  asset: string;
  address: string;
}

/// ETH balance is used for transfer out when amount is negative
export async function sourceTokens({
  hre,
  amount: amount_,
  asset,
  address,
}: SourceTokenParameters) {
  const amount = BigNumber.from(amount_);

  if (amount.isNegative()) {
    await removeTokens(hre, amount.abs(), asset, address);
  } else {
    await addTokens(hre, amount, asset, address);
  }
}

async function removeTokens(
  hre: HardhatRuntimeEnvironment,
  amount: BigNumber,
  asset: string,
  address: string
) {
  const erc20Abi = JSON.parse(await fs.promises.readFile('./contracts/ERC20.abi', 'utf8'));
  const ethers = hre.ethers;
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });
  const signer = await ethers.getSigner(address);
  const tokenContract = new ethers.Contract(asset, erc20Abi, signer);
  const currentBalance = await tokenContract.balanceOf(address);
  if (currentBalance.lt(amount)) throw 'Error: Insufficient address balance';
  await tokenContract.transfer('0x0000000000000000000000000000000000000000', amount);
  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [address],
  });
}

async function addTokens(
  hre: HardhatRuntimeEnvironment,
  amount: BigNumber,
  asset: string,
  address: string,
  block?: number,
  offsetBlocks?: number
) {
  const erc20Abi = JSON.parse(fs.readFileSync('./contracts/ERC20.abi', 'utf-8'));
  const ethers = hre.ethers;
  const signer = (await ethers.getSigners())[0];
  block = block ?? (await ethers.provider.getBlockNumber());
  const tokenContract = new ethers.Contract(asset, erc20Abi, ethers.provider);
  const filter = tokenContract.filters.Transfer();
  const [recentLogs, blocksDelta] = await fetchQuery(
    tokenContract,
    filter,
    block - 1000 - (offsetBlocks ?? 0),
    block - (offsetBlocks ?? 0)
  );
  const holder = await searchLogs(recentLogs, amount, tokenContract, ethers);
  if (holder) {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [holder],
    });
    const impersonatedSigner = await ethers.getSigner(holder);
    const impersonatedProviderTokenContract = tokenContract.connect(impersonatedSigner);
    // Give impersonated address ETH for TX
    await signer.sendTransaction({
      to: impersonatedSigner.address,
      value: ethers.utils.parseEther('1.0'),
    });
    await impersonatedProviderTokenContract.transfer(address, amount);
    await hre.network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [holder],
    });
  } else {
    if ((offsetBlocks ?? 0) > 40000) throw "Error: Couldn't find sufficient tokens";
    await addTokens(hre, amount, asset, address, block, (offsetBlocks ?? 0) + blocksDelta);
  }
}

async function fetchQuery(
  contract: Contract,
  filter: EventFilter,
  fromBlock: number,
  toBlock: number
): Promise<[Event[], number]> {
  try {
    const res = await contract.queryFilter(filter, fromBlock, toBlock);
    if (res.length > 0) {
      return [res, toBlock - fromBlock];
    } else {
      return await fetchQuery(contract, filter, fromBlock - 1000, toBlock);
    }
  } catch {
    const midBlock = (fromBlock + toBlock) / 2;
    return await fetchQuery(contract, filter, midBlock, toBlock);
  }
}

async function searchLogs(
  recentLogs: Event[],
  amount: BigNumber,
  tokenContract: Contract,
  ethers: HardhatRuntimeEnvironment['ethers'],
  logOffset?: number
): Promise<string | null> {
  const toAddresses = new Set<string>();
  if ((logOffset ?? 0) >= recentLogs.length) return null;
  recentLogs.slice(logOffset ?? 0, (logOffset ?? 0) + 20).map((log) => {
    toAddresses.add(log.args![1]);
  });
  const balancesDict = new Map<string, BigNumber>();
  const addressContracts = new Map<string, boolean>();
  await Promise.all([
    ...Array.from(toAddresses).map(async (address) => {
      balancesDict.set(address, await tokenContract.balanceOf(address));
    }),
    ...Array.from(toAddresses).map(async (address) => {
      const code = await ethers.provider.getCode(address);
      addressContracts.set(address, code !== '0x');
    }),
  ]);
  for (const address of Array.from(addressContracts.keys())) {
    if (addressContracts.get(address)) {
      // Remove contracts from search
      balancesDict.delete(address);
    }
  }
  const max = getMaxEntry(Array.from(balancesDict.entries()));
  if (max[1].gte(amount)) {
    return max[0];
  } else {
    return searchLogs(recentLogs, amount, tokenContract, ethers, (logOffset ?? 0) + 20);
  }
}
