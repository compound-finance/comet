import { BigNumber } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

import { paramString } from '../../plugins/import/import';
import { get, getEtherscanApiKey, getEtherscanApiUrl } from '../../plugins/import/etherscan';
import { TransferEvent } from '../../build/types/Comet';
import { IncentivizationCampaignData } from './types';
import { CometInterface } from '../../build/types';

import {
  mkdir,
  writeFile,
  readFile,
} from 'fs/promises';
import { readdirSync } from 'fs';
import path from 'path';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { getEtherscanUrl } from '../../plugins/import/etherscan';
import { multicallAddresses, transferEventsFetchSettings } from './constants';
import { CampaignType } from './types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ethers } from 'ethers';
import { delay } from '@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanService';

interface FileData {
  timestamp: number;
  blockNumber: number;
  type: 'start' | 'finish';
}

function findLastStartFinishPair(files: FileData[]) {
  if (files.length === 0) {
    return { start: null, finish: null };
  }
  // sort files by timestamp
  files.sort((a, b) => a.timestamp - b.timestamp);

  // find latest finish file
  let finish: FileData | null = null;
  let start: FileData | null = null;
  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (file.type === 'finish') {
      finish = file;
      break;
    }
  }
  if (finish) {
    // find latest start file before finish file
    for (let i = files.indexOf(finish) - 1; i >= 0; i--) {
      const file = files[i];
      if (file.type === 'start') {
        start = file;
        break;
      }
    }
  }
  else {
    // find latest start file
    for (let i = files.length - 1; i >= 0; i--) {
      const file = files[i];
      if (file.type === 'start') {
        start = file;
        break;
      }
    }
  }
  return { start, finish };
}


export const getLatestStartAndFinishMerkleTreeForCampaign = async (
  network: string,
  deployment: string,
  hre: HardhatRuntimeEnvironment,
): Promise<{ startTree: StandardMerkleTree<string[]>, finishTree: StandardMerkleTree<string[]> }> => {
  const folderPath = `./campaigns/${network}-${deployment}/`;
  console.log(folderPath);
  // Ensure the directory exists
  await mkdir(folderPath, { recursive: true });
  let result: { start: FileData, finish: FileData };
  try {
    const files: FileData[] = readdirSync(folderPath).map(filename => {
      const [timestampStr, blockNumberStr, typeWithExtension] = filename.split('-');
      const type = typeWithExtension.replace('.json', '') as 'start' | 'finish'; // remove .json from type
      return {
        timestamp: Number(timestampStr),
        blockNumber: Number(blockNumberStr),
        type
      };
    });
    result = findLastStartFinishPair(files);
  }
  catch (e) {
    console.error('Error reading files from folder:', e);
    result = { start: null, finish: null };
  }
  const startFile = result?.start;
  const finishFile = result?.finish;

  let startTimestamp = 0;
  let startBlockNumber = 0;
  if (!startFile) {
    console.log('Start file not found. Generating new start file');
    const currentBlock = await hre.ethers.provider.getBlock('latest');

    await generateMerkleTreeForCampaign(network, deployment, currentBlock.number, 'start', hre);
    const newResult = findLastStartFinishPair(readdirSync(folderPath).map(filename => {
      const [timestampStr, blockNumberStr, typeWithExtension] = filename.split('-');
      const type = typeWithExtension.replace('.json', '') as 'start' | 'finish'; // remove .json from type
      return {
        timestamp: Number(timestampStr),
        blockNumber: Number(blockNumberStr),
        type
      };
    }));
    startTimestamp = newResult.start.timestamp;
    startBlockNumber = newResult.start.blockNumber;
  } else {
    startTimestamp = startFile.timestamp;
    startBlockNumber = startFile.blockNumber;
  }

  let finishTimestamp = 0;
  let finishBlockNumber = 0;
  if (!finishFile) {
    console.log('Finish file not found. Generating new finish file');
    // wait 1000 seconds
    await hre.network.provider.request({
      method: 'evm_increaseTime',
      params: [60 * 60 * 24 * 30], // month
    });
    await hre.network.provider.request({
      method: 'evm_mine',
      params: [],
    });
    const newBlock = await hre.ethers.provider.getBlock('latest');
    const newBlockNumber = newBlock.number;
    await generateMerkleTreeForCampaign(network, deployment, newBlockNumber, 'finish', hre);

    const newResult = findLastStartFinishPair(readdirSync(folderPath).map(filename => {
      const [timestampStr, blockNumberStr, typeWithExtension] = filename.split('-');
      const type = typeWithExtension.replace('.json', '') as 'start' | 'finish'; // remove .json from type
      return {
        timestamp: Number(timestampStr),
        blockNumber: Number(blockNumberStr),
        type
      };
    }));
    finishTimestamp = newResult.finish.timestamp;
    finishBlockNumber = newResult.finish.blockNumber;
  }
  else {
    finishTimestamp = finishFile.timestamp;
    finishBlockNumber = finishFile.blockNumber;
  }


  const startData = await readFile(`${folderPath}${startTimestamp}-${startBlockNumber}-start.json`, 'utf-8');
  const startFileData = JSON.parse(startData) as IncentivizationCampaignData;
  const startTreeData = Object.entries(startFileData.data).map(([address, { index, accrue }]) => [address, index.toString(), accrue]);
  const startTree = generateMerkleTree(startTreeData);

  const finishData = await readFile(`${folderPath}${finishTimestamp}-${finishBlockNumber}-finish.json`, 'utf-8');
  const finishFileData = JSON.parse(finishData) as IncentivizationCampaignData;
  const finishTreeData = Object.entries(finishFileData.data).map(([address, { index, accrue }]) => [address, index.toString(), accrue]);
  const finishTree = generateMerkleTree(finishTreeData);

  console.log(`Latest start file: ${startTimestamp}-${startBlockNumber}-start.json`);
  console.log(`Latest finish file: ${finishTimestamp}-${finishBlockNumber}-finish.json`);
  return { startTree, finishTree };
};

export const generateMerkleTreeForCampaign = async (
  network: string,
  deployment: string,
  blockNumber: number,
  type: CampaignType,
  hre: HardhatRuntimeEnvironment
): Promise<StandardMerkleTree<string[]>> => {
  console.log(`Generating Merkle tree for ${type} of campaign with deployment: ${deployment}`);

  if (!deployment) {
    throw new Error('missing required env variable: DEPLOYMENT');
  }

  if (!type || !['start', 'finish'].includes(type)) {
    throw new Error('type should be \'start\' or \'finish\'');
  }

  if (blockNumber === 0) {
    blockNumber = await hre.ethers.provider.getBlockNumber();
    console.log(`Block number not provided or set to 0. Using latest block: ${blockNumber}`);
  }

  const generatedTimestamp = Date.now();

  const dm = new DeploymentManager(
    network,
    deployment,
    hre,
    {
      writeCacheToDisk: true,
      verificationStrategy: 'eager',
    }
  );

  console.log(`Campaign block number ${blockNumber}`);
  console.log(`Start fetching contracts for ${network}-${deployment} deployment`);

  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

  const { blockNumber: cometDeployedBlockNumber, hash } = await getContractDeploymentData(network, comet.address);

  console.log(`Comet address ${getEtherscanUrl(network)}/address/${comet.address}`);
  console.log(`Comet deployed transaction ${getEtherscanUrl(network)}/trx/${hash}`);
  console.log(`Comet deployed block ${cometDeployedBlockNumber}`);

  const fetchSettings = transferEventsFetchSettings[network];
  const transferEvents = await getAllTransferEvents(comet, cometDeployedBlockNumber, blockNumber, dm, fetchSettings?.chunkSize, fetchSettings?.delaySeconds);
  const users = getAllCometUsers(transferEvents);

  console.log(`Transfer events count ${transferEvents.length}`);
  console.log(`Transfer events unique addresses ${users.length}`);

  const multicallAddress = multicallAddresses[network];
  if (!multicallAddress) {
    throw new Error('Network is not supported');
  }

  const { data } = await multicall(multicallAddress, comet.address, users, blockNumber, dm);

  if (!data['0x0000000000000000000000000000000000000000']) {
    data['0x0000000000000000000000000000000000000000'] = '0';
  }

  if (!data['0xffffffffffffffffffffffffffffffffffffffff']) {
    data['0xffffffffffffffffffffffffffffffffffffffff'] = '0';
  }

  const sortedDataWithIndexes = Object.entries(data)
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase())) // Sort by address (key) in ascending order
    .map(([address, accrued], index) => [address.toLowerCase(), index.toString(), accrued]);

  const merkleTree = generateMerkleTree(sortedDataWithIndexes);

  const file = createCampaignFile(
    sortedDataWithIndexes,
    merkleTree,
    { network, market: deployment, blockNumber, generatedTimestamp, type }
  );

  const filename = `${generatedTimestamp}-${blockNumber}-${type}.json`;
  const filePath = `./campaigns/${network}-${deployment}/${filename}`;

  // Ensure the directory exists
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });

  await writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8');

  console.log('Merkle tree successfully generated');
  return merkleTree;
};

export const getContractDeploymentData = async (network: string, address: string): Promise<{ blockNumber: number, hash: string }> => {
  const params = {
    module: 'account',
    action: 'txlist',
    address,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: 10,
    sort: 'asc',
    apikey: getEtherscanApiKey(network)
  };
  const url = `${getEtherscanApiUrl(network)}?${paramString(params)}`;
  const result = await get(url, {});
  const firstTransaction = result.result[0];

  if (!firstTransaction) return null;

  return { blockNumber: +firstTransaction.blockNumber, hash: firstTransaction.hash, };
};

export const padAddressTo64Chars = (address: string): string => {
  // Remove "0x" prefix if present
  const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;

  // Ensure the address is in lowercase
  const lowerCaseAddress = cleanAddress.toLowerCase();

  // Pad the address with leading zeros to make it 64 characters
  const paddedAddress = lowerCaseAddress.padStart(64, '0');

  return paddedAddress;
};

export const getFunctionSelector = (functionSignature: string, hre: HardhatRuntimeEnvironment): string => {
  // Calculate the Keccak-256 hash of the function signature
  const hash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(functionSignature));

  return hash.slice(2, 10); // first 8 hex characters
};

export const blockNumberToBlockTag = (blockNumber: number) => {
  return `0x${blockNumber.toString(16)}`;
};

// [address, index, accrued][]
export const generateMerkleTree = (data: string[][]) => {
  return StandardMerkleTree.of(data, [
    'address',
    'uint256',
    'uint256',
  ]);
};

export const getMerkleTreeProof = (address: string, tree: StandardMerkleTree<string[]>) => {
  for (const [i, v] of tree.entries()) {
    if (v[0] === address) {
      const proof = tree.getProof(i);
      return { proof, v };
    }
  }
  return undefined;
};

export const getAllCometUsers = (transferEvents: TransferEvent[]) => {
  const setOfAddresses = new Set<string>();

  transferEvents.forEach(transfer => {
    setOfAddresses.add(transfer.args.from);
    setOfAddresses.add(transfer.args.to);
  });

  return Array.from(setOfAddresses).sort();
};

export const createMulticallCallsToGetBaseTrackingAccruedPerAddress = (cometAddress: string, userAddress: string, hre: HardhatRuntimeEnvironment) => {
  const calls = [
    // Updates baseTrackingAccrued for userAddress. Returns 0x
    {
      target: cometAddress,
      callData: `0x${getFunctionSelector('accrueAccount(address)', hre)}${padAddressTo64Chars(userAddress)}`
    },
    // Returns userBasic struct, which includes baseTrackingAccrued
    {
      target: cometAddress,
      callData: `0x${getFunctionSelector('userBasic(address)', hre)}${padAddressTo64Chars(userAddress)}`
    }
  ];

  return calls;
};

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export const multicall = async (multicallAddress: string, cometAddress: string, userAddresses: string[], blockNumber: number, dm: DeploymentManager) => {
  const multicallABI = [
    'function aggregate((address target, bytes callData)[] memory calls) external returns (uint256 blockNumber, bytes[] memory returnData)'
  ];

  const multicallContract = new dm.hre.ethers.Contract(multicallAddress, multicallABI, dm.hre.ethers.provider);
  const userAddressToAccrue: { [address: string]: string } = {};

  // Split user addresses into chunks of 1,000
  const chunks = chunkArray(userAddresses, 1000);

  // Process each chunk separately
  for (const chunk of chunks) {
    const calls: { target: string, callData: string }[] = [];

    chunk.forEach(address => {
      calls.push(...createMulticallCallsToGetBaseTrackingAccruedPerAddress(cometAddress, address, dm.hre));
    });

    const [, returnData] = await multicallContract.callStatic.aggregate(calls, {
      blockTag: blockNumberToBlockTag(blockNumber)
    });

    if (!returnData || returnData.length !== chunk.length * 2) {
      throw new Error('Incorrect multicall request');
    }

    // Decode results for this chunk
    returnData.forEach((data: string, index: number) => {
      if (index % 2 !== 0) {
        const result = dm.hre.ethers.utils.defaultAbiCoder.decode(
          ['int104', 'uint64', 'uint64', 'uint16', 'uint8'],
          data
        ) as [BigNumber, BigNumber, BigNumber, number, number];

        userAddressToAccrue[chunk[(index - 1) / 2]] = result[2].toString();
      }
    });
  }

  const response = { blockNumber, data: userAddressToAccrue };
  return response;
};

export const createCampaignFile = (data: string[][], tree: StandardMerkleTree<string[]>, conf: { network: string, market: string, type: 'start' | 'finish', blockNumber: number, generatedTimestamp: number }): IncentivizationCampaignData => {
  const file = {} as IncentivizationCampaignData;

  file.root = tree.root;
  file.network = conf.network;
  file.market = conf.market;
  file.type = conf.type;
  file.blockNumber = conf.blockNumber;
  file.generatedTimestamp = conf.generatedTimestamp;

  const payload = {};

  data.forEach(d => payload[d[0]] = {
    index: +d[1],
    proof: getMerkleTreeProof(d[0], tree),
    accrue: d[2]
  });

  file.data = payload;

  return file;
};

export const getAllTransferEvents = async (comet: CometInterface, startBlock: number, endBlock: number, dm: DeploymentManager, chunkSize: number = 100000, delaySeconds: number = 5) => {
  let allEvents: any[] = [];

  for (let fromBlock = startBlock; fromBlock < endBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, endBlock);
    try {
      const events = await dm.retry(() => {
        return comet.queryFilter(comet.filters.Transfer(), fromBlock, toBlock);
      });
      allEvents = allEvents.concat(events);
      console.log(`Fetched events from block ${fromBlock} to ${toBlock}`);
      await delay(delaySeconds * 1000);
    } catch (error) {
      throw new Error(`Error fetching events from block ${fromBlock} to ${toBlock}: ${error}`);
    }
  }

  return allEvents;
};

export const calculateMultiplier = async (supplySpeed: bigint, borrowSpeed: bigint, duration: number, amount: bigint) => {
  // to distribute exactly the amount of rewards in the given duration
  //    we need to adjust the speed with the multiplier

  // amount = totalSpeed * multiplier * duration
  // multiplier = amount / (totalSpeed * duration)
  const totalSpeed = supplySpeed + borrowSpeed;

  const multiplier = BigNumber.from(amount * BigInt(1e15) * BigInt(1e18)).div((totalSpeed * BigInt(duration)));

  console.log(`\n=========================================`);
  console.log(`Amount to of tokens distribute:   ${amount}`);
  console.log(`Duration in seconds:              ${duration}`);
  console.log(`=========================================`);

  console.log(`\n=========================================`);
  console.log(`Supply speed per day:             ${ethers.utils.formatUnits(supplySpeed * BigInt(86400), 15)}`);
  console.log(`Borrow speed per day:             ${ethers.utils.formatUnits(borrowSpeed * BigInt(86400), 15)}`);
  console.log(`Total speed per day:              ${ethers.utils.formatUnits(totalSpeed * BigInt(86400), 15)}`);
  console.log(`Basic rewards for given duration: ${ethers.utils.formatUnits(totalSpeed * BigInt(duration), 15)}`);
  console.log(`Formula for multiplier:           amount / (totalSpeed * duration)`);
  console.log(`=========================================`);

  console.log(`\n=========================================`);
  console.log(`Supply rewards per day:           ${ethers.utils.formatUnits(supplySpeed * multiplier.toBigInt() * BigInt(86400) / BigInt(1e18), 15)}`);
  console.log(`Borrow rewards per day:           ${ethers.utils.formatUnits(borrowSpeed * multiplier.toBigInt() * BigInt(86400) / BigInt(1e18), 15)}`);
  console.log(`Multiplier %:                     ${ethers.utils.formatUnits(multiplier.mul(100), 18).toString()}`);
  console.log(`Multiplier with decimals:         ${multiplier.toString()}`);
  console.log(`=========================================\n`);

  return multiplier;
};
