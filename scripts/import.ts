import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Result, get, getEtherscanApiUrl, getEtherscanUrl } from './helpers/etherscan';

/**
 * Copied from Saddle import with some small modifications.
 */

export async function loadContract(source: string, network: string, address: string, outdir: string, verbose: number) {
    switch (source) {
        case 'etherscan':
            return await loadEtherscanContract(network, address, outdir, verbose);
        default:
            throw new Error(`Unknown source \`${source}\`, expected one of [etherscan]`);
    }
}

interface EtherscanSource {
    SourceCode: string,
    ABI: string,
    ContractName: string,
    CompilerVersion: string,
    OptimizationUsed: string,
    Runs: string,
    ConstructorArguments: string,
    Library: string,
    LicenseType: string,
    SwarmSource: string
}

async function getEtherscanApiData(network: string, address: string) {
    let apiUrl = await getEtherscanApiUrl(network);
    let result: Result = <Result>await get(apiUrl, { module: 'contract', action: 'getsourcecode', address, apikey: process.env.ETHERSCAN_KEY, });

    if (result.status !== '1') {
        throw new Error(`Etherscan Error: ${result.message}`);
    }

    let s = <EtherscanSource><unknown>result.result[0];

    if (s.ABI === "Contract source code not verified") {
        throw new Error("Contract source code not verified");
    }

    return {
        source: s.SourceCode,
        abi: JSON.parse(s.ABI),
        contract: s.ContractName,
        compiler: s.CompilerVersion,
        optimized: s.OptimizationUsed !== '0',
        optimzationRuns: Number(s.Runs),
        constructorArgs: s.ConstructorArguments
    };
}

async function getContractCreationCode(network: string, address: string) {
    let url = `${await getEtherscanUrl(network)}/address/${address}#code`;
    let result = <string>await get(url, {}, null);
    let regex = /<div id='verifiedbytecode2'>[\s\r\n]*([0-9a-fA-F]*)[\s\r\n]*<\/div>/g;
    let matches = [...result.matchAll(regex)];
    if (matches.length === 0) {
        throw new Error('Failed to pull deployed contract code from Etherscan');
    }

    return matches[0][1];
}

export async function loadEtherscanContract(network: string, address: string, outdir: string, verbose: number) {
    // Okay, this is where the fun begins, let's gather as much information as we can

    let {
        source,
        abi,
        contract,
        compiler,
        optimized,
        optimzationRuns,
        constructorArgs
    } = await getEtherscanApiData(network, address);

    let contractCreationCode = await getContractCreationCode(network, address);
    let encodedABI = JSON.stringify(abi);
    let contractSource = `contracts/${contract}.sol:${contract}`;

    let contractBuild = {
        contract: {
            address,
            name: contract,
            abi: encodedABI,
            bin: contractCreationCode,
            metadata: JSON.stringify({
                compiler: {
                    version: compiler
                },
                language: "Solidity",
                output: {
                    abi: encodedABI
                },
                devdoc: {},
                sources: {
                    [contractSource]: {
                        content: source,
                        keccak256: ""
                    }
                },
                version: 1
            })
        },
        version: compiler
    };

    outdir = path.join(__dirname, outdir);
    let outfile = path.join(outdir, `${address}.json`);

    await fs.promises.mkdir(outdir, { recursive: true }).catch(console.error);
    await util.promisify(fs.writeFile)(outfile, JSON.stringify(contractBuild, null, 2));
    return contractBuild;
}