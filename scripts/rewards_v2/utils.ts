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
import { multicallAddresses } from './constants';
import { CampaignType } from './types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

interface FileData {
  timestamp: number;
  blockNumber: number;
  type: 'start' | 'finish';
}

function findLastStartFinishPair(files: FileData[]) {
  if(files.length === 0) {
    return {start: null, finish: null};
  }
  // sort files by timestamp
  files.sort((a, b) => a.timestamp - b.timestamp);

  // find latest finish file
  let finish: FileData | null = null;
  let start: FileData | null = null;
  for(let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (file.type === 'finish') {
      finish = file;
      break;
    }
  }
  if(finish) {
    // find latest start file before finish file
    for(let i = files.indexOf(finish) - 1; i >= 0; i--) {
      const file = files[i];
      if (file.type === 'start') {
        start = file;
        break;
      }
    }
  }
  else {
    // find latest start file
    for(let i = files.length - 1; i >= 0; i--) {
      const file = files[i];
      if (file.type === 'start') {
        start = file;
        break;
      }
    }
  }
  return {start, finish};
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
  try{
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
  catch(e) {
    console.error('Error reading files from folder:', e);
    result = {start: null, finish: null};
  }
  const startFile = result?.start;
  const finishFile = result?.finish;

  if (!startFile) {
    console.log('Start file not found. Generating new start file');
    const currentBlock = await hre.ethers.provider.getBlock('latest');
    const previousBlockNumber = currentBlock.number - 1000;
    const previousBlock = await hre.ethers.provider.getBlock(previousBlockNumber);
    console.log(`Previous block number: ${previousBlockNumber}`);
    console.log(`currentBlock: ${currentBlock.number}`);
    console.log(`previousBlock: ${previousBlock.number}`);
    
    await generateMerkleTreeForCampaign(network, deployment, previousBlockNumber, 'start', hre);
    startFile.timestamp = previousBlock.timestamp;
    startFile.blockNumber = previousBlockNumber;
  }

  if (!finishFile) {
    console.log('Finish file not found. Generating new finish file');
    const currentBlock = await hre.ethers.provider.getBlock('latest');
    const currentBlockNumber = currentBlock.number;
    await generateMerkleTreeForCampaign(network, deployment, currentBlockNumber, 'finish', hre);
    finishFile.timestamp = currentBlock.timestamp;
    finishFile.blockNumber = currentBlockNumber;
  }

  const startData = await readFile(`${folderPath}/${startFile.timestamp}-${startFile.blockNumber}-start.json`, 'utf-8');
  const startFileData = JSON.parse(startData) as IncentivizationCampaignData;
  const startTreeData = Object.entries(startFileData.data).map(([address, { index, accrue }]) => [address, index.toString(), accrue]);
  const startTree = generateMerkleTree(startTreeData);

  const finishData = await readFile(`${folderPath}/${finishFile.timestamp}-${finishFile.blockNumber}-finish.json`, 'utf-8');
  const finishFileData = JSON.parse(finishData) as IncentivizationCampaignData;
  const finishTreeData = Object.entries(finishFileData.data).map(([address, { index, accrue }]) => [address, index.toString(), accrue]);
  const finishTree = generateMerkleTree(finishTreeData);

  console.log(`Latest start file: ${startFile.timestamp}-${startFile.blockNumber}-start.json`);
  console.log(`Latest finish file: ${finishFile.timestamp}-${finishFile.blockNumber}-finish.json`);
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

  const transferEvents = await getAllTransferEvents(comet, cometDeployedBlockNumber, blockNumber);
  const users = getAllCometUsers(transferEvents);

  console.log(`Transfer events count ${transferEvents.length}`);
  console.log(`Transfer events unique addresses (both from and to) ${users.length}`);

  const multicallAddress = multicallAddresses[network];
  if (!multicallAddress) {
    console.error(`Multicall is not supported by ${network} network`);
    process.exit(1);
  }

  const { data } = await multicall(multicallAddress, comet.address, users, blockNumber, hre);

  if (!data['0x0000000000000000000000000000000000000000']) {
    data['0x0000000000000000000000000000000000000000'] = '0';
  }

  if (!data['0xffffffffffffffffffffffffffffffffffffffff']) {
    data['0xffffffffffffffffffffffffffffffffffffffff'] = '0';
  }

  const sortedDataWithIndexes = Object.entries(data)
    .sort((a, b) => a[0].localeCompare(b[0])) // Sort by address (key) in ascending order
    .map(([address, accrued], index) => [address, index.toString(), accrued]);

  const merklTree = generateMerkleTree(sortedDataWithIndexes);

  const file = createCampaignFile(
    sortedDataWithIndexes,
    merklTree,
    { network, market: deployment, blockNumber, generatedTimestamp, type }
  );

  const filename = `${generatedTimestamp}-${blockNumber}-${type}.json`;
  const filePath = `./campaigns/${network}-${deployment}/${filename}`;

  // Ensure the directory exists
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });

  await writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8');

  console.log('Merkle tree successfully generated');
  return merklTree;
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

export const getMerklTreeProof = (address: string, tree: StandardMerkleTree<string[]>) => {
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

export const multicall = async (multicallAddress: string, cometAddress: string, userAddresses: string[], blockNumber: number, hre: HardhatRuntimeEnvironment) => {
  const multicallABI = [
    'function aggregate((address target, bytes callData)[] memory calls) external view returns (uint256 blockNumber, bytes[] memory returnData)'
  ];

  const multicallContract = new hre.ethers.Contract(multicallAddress, multicallABI, hre.ethers.provider);
  const userAddressToAccrue: { [address: string]: string } = {};

  // Split user addresses into chunks of 1,000
  const chunks = chunkArray(userAddresses, 500);

  // Process each chunk separately
  for (const chunk of chunks) {
    const calls: { target: string, callData: string }[] = [];

    chunk.forEach(address => {
      calls.push(...createMulticallCallsToGetBaseTrackingAccruedPerAddress(cometAddress, address, hre));
    });

    const [, returnData] = await multicallContract.callStatic.aggregate(calls, {
      blockTag: blockNumberToBlockTag(blockNumber)
    });

    if (!returnData || returnData.length !== chunk.length * 2) {
      console.error('Incorrect multicall');
      process.exit(1);
    }

    // Decode results for this chunk
    returnData.forEach((data: string, index: number) => {
      if (index % 2 !== 0) {
        const result = hre.ethers.utils.defaultAbiCoder.decode(
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
    proof: getMerklTreeProof(d[0], tree),
    accrue: d[2]
  });

  file.data = payload;

  return file;
};

export const getAllTransferEvents = async (comet: CometInterface, startBlock: number, endBlock: number, chunkSize: number = 500000) => {
  let allEvents: any[] = [];

  for (let fromBlock = startBlock; fromBlock < endBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, endBlock);
    try {
      const events = await comet.queryFilter(comet.filters.Transfer(), fromBlock, toBlock);
      allEvents = allEvents.concat(events);
      console.log(`Fetched events from block ${fromBlock} to ${toBlock}`);
    } catch (error) {
      console.error(`Error fetching events from block ${fromBlock} to ${toBlock}:`, error);
    }
  }

  return allEvents;
};
