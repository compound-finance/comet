// 1. Collect all the users from the start of comet to start of campaign block
// 2. Get current accrued values for all the users
// 3. Generate input data for merkle tree
// 4. Generate tree
// 5. Save JSON

// 6. Github workflow

// 7. Verify with Dune Dashboard

// To run script
// npm run rewards-v2 -- --network mainnet

import hre from 'hardhat';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { CometInterface } from '../../build/types';
import { getEtherscanUrl } from '../../plugins/import/etherscan';
import { createCampaignFile, generateMerklTree, getAllCometUsers, getAllTransferEvents, getContractDeploymentData, multicall } from './utils';
import { multicallAddresses } from './constants';
import { CampaignType } from './types';

const main = async () => {
    console.log('Start Rewards V2 hash generation')

    let { DEPLOYMENT: deployment, BLOCK_NUMBER, TYPE: type } = process.env;
    let blockNumber: number;

    if (!deployment) {
        throw new Error('missing required env variable: DEPLOYMENT');
    }

    if (!type || !['start', 'finish'].includes(type)) {
        throw new Error('type should be start or finish')
    }

    const generatedTimestamp = Date.now()
    const network = hre.network.name;
    blockNumber = +BLOCK_NUMBER || await hre.ethers.provider.getBlockNumber()

    const dm = new DeploymentManager(
        network,
        deployment,
        hre,
        {
            writeCacheToDisk: true,
            verificationStrategy: 'eager',
        }
    );

    console.log(`Campaign block number ${blockNumber}`)
    console.log(`Start fetching contracts for ${network}-${deployment} deployment`)

    await dm.spider();

    const contracts = await dm.contracts();
    const comet = contracts.get('comet') as CometInterface;

    const { blockNumber: cometDeployedBlockNumber, hash } = await getContractDeploymentData(network, comet.address)

    console.log(`Comet address ${getEtherscanUrl(network)}/address/${comet.address}`)
    console.log(`Comet deployed transaction ${getEtherscanUrl(network)}/trx/${hash}`)
    console.log(`Comet deployed block ${cometDeployedBlockNumber}`)

    const transferEvents = await getAllTransferEvents(comet, cometDeployedBlockNumber, blockNumber)
    const users = getAllCometUsers(transferEvents)

    console.log(`Transfer events count ${transferEvents.length}`)
    console.log(`Transfer events unique addresses (both from and to) ${users.length}`)


    const multicallAddress = multicallAddresses[network]

    if (!multicallAddress) {
        console.error(`Multicall is not supported by ${network} network`)
        process.exit(1)
    }

    const { data } = await multicall(multicallAddress, comet.address, users, blockNumber)

    if (!data['0x0000000000000000000000000000000000000000']) {
        data['0x0000000000000000000000000000000000000000'] = '0'
    }

    if (!data['0xffffffffffffffffffffffffffffffffffffffff']) {
        data['0xffffffffffffffffffffffffffffffffffffffff'] = '0'
    }

    const sortedDataWithIndexes = Object.entries(data)
        .sort((a, b) => a[0].localeCompare(b[0])) // Sort by address (key) in ascending order
        .map(([address, accrued], index) => [address, index.toString(), accrued]);

    const merklTree = generateMerklTree(sortedDataWithIndexes)

    const file = createCampaignFile(sortedDataWithIndexes, merklTree, { network, market: deployment, blockNumber, generatedTimestamp, type: type as CampaignType })
    const filename = `${generatedTimestamp}-${blockNumber}-start.json`;
    const filePath = `./campaigns/${network}-${deployment}/${filename}`;

    // Ensure the directory exists
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true });

    await writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8')
}

main().then().catch(console.error)