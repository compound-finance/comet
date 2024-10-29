import { BigNumber } from 'ethers';
import hre, { ethers } from 'hardhat';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

import { paramString } from '../../plugins/import/import';
import { get, getEtherscanApiKey, getEtherscanApiUrl } from '../../plugins/import/etherscan';
import { TransferEvent } from '../../build/types/Comet';
import { IncentivizationCampaignData } from './types';
import { CometInterface } from '../../build/types';

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
    const firstTransaction = result.result[0]

    if (!firstTransaction) return null

    return { blockNumber: +firstTransaction.blockNumber, hash: firstTransaction.hash, }
}

export const padAddressTo64Chars = (address: string): string => {
    // Remove "0x" prefix if present
    const cleanAddress = address.startsWith("0x") ? address.slice(2) : address;

    // Ensure the address is in lowercase
    const lowerCaseAddress = cleanAddress.toLowerCase();

    // Pad the address with leading zeros to make it 64 characters
    const paddedAddress = lowerCaseAddress.padStart(64, '0');

    return paddedAddress
}

export const getFunctionSelector = (functionSignature: string): string => {
    // Calculate the Keccak-256 hash of the function signature
    const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(functionSignature));

    return hash.slice(2, 10); // first 8 hex characters
}

export const blockNumberToBlockTag = (blockNumber: number) => {
    return `0x${blockNumber.toString(16)}`
}

// [address, index, accrued][]
export const generateMerklTree = (data: string[][]) => {
    return StandardMerkleTree.of(data, [
        'address',
        'uint256',
        'uint256',
    ]);
}

export const getMerklTreeProof = (address: string, tree: StandardMerkleTree<string[]>) => {
    for (const [i, v] of tree.entries()) {
        if (v[0] === address) {
            const proof = tree.getProof(i);
            return { proof, v };
        }
    }
    return undefined;
}

export const getAllCometUsers = (transferEvents: TransferEvent[]) => {
    const setOfAddresses = new Set<string>()

    transferEvents.forEach(transfer => {
        setOfAddresses.add(transfer.args.from)
        setOfAddresses.add(transfer.args.to)
    })

    return Array.from(setOfAddresses).sort()
}

export const createMulticallCallsToGetBaseTrackingAccruedPerAddress = (cometAddress: string, userAddress: string) => {
    const calls = [
        // Updates baseTrackingAccrued for userAddress. Returns 0x
        {
            target: cometAddress,
            callData: `0x${getFunctionSelector('accrueAccount(address)')}${padAddressTo64Chars(userAddress)}`
        },
        // Returns userBasic struct, which includes baseTrackingAccrued
        {
            target: cometAddress,
            callData: `0x${getFunctionSelector('userBasic(address)')}${padAddressTo64Chars(userAddress)}`
        }
    ]

    return calls
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

export const multicall = async (multicallAddress: string, cometAddress: string, userAddresses: string[], blockNumber: number) => {
    const multicallABI = [
        "function aggregate((address target, bytes callData)[] memory calls) external view returns (uint256 blockNumber, bytes[] memory returnData)"
    ];

    const multicallContract = new ethers.Contract(multicallAddress, multicallABI, hre.ethers.provider);
    const userAddressToAccrue: { [address: string]: string } = {};

    // Split user addresses into chunks of 1,000
    const chunks = chunkArray(userAddresses, 1000);

    // Process each chunk separately
    for (const chunk of chunks) {
        const calls: { target: string, callData: string }[] = [];

        chunk.forEach(address => {
            calls.push(...createMulticallCallsToGetBaseTrackingAccruedPerAddress(cometAddress, address));
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
                const result = ethers.utils.defaultAbiCoder.decode(
                    ["int104", "uint64", "uint64", "uint16", "uint8"],
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
    const file = {} as IncentivizationCampaignData

    file.root = tree.root
    file.network = conf.network
    file.market = conf.market
    file.type = conf.type
    file.blockNumber = conf.blockNumber
    file.generatedTimestamp = conf.generatedTimestamp

    const payload = {}

    data.forEach(d => payload[d[0]] = {
        index: +d[1],
        proof: getMerklTreeProof(d[0], tree),
        accrue: d[2]
    })

    file.data = payload

    return file
}

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
}