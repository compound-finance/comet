import * as fs from 'fs';
import * as path from 'path';
import { get, getEtherscanApiUrl, getEtherscanUrl } from './etherscan';

/**
 * Copied from Saddle import with some small modifications.
 * 
 * NOTE: This program also exists as a Hardhat plugin in a separate repo, but we
 * are temporarily moving it back into the protocol repo for easier development.
 */

export async function loadContract(source: string, network: string, address: string) {
    switch (source) {
        case 'etherscan':
            return await loadEtherscanContract(network, address);
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

async function getEtherscanApiData(
    network: string,
    address: string,
    apiKey: string
) {
    let apiUrl = await getEtherscanApiUrl(network);

    let result = await get(apiUrl, {
        module: "contract",
        action: "getsourcecode",
        address,
        apikey: apiKey,
    });

    if (result.status !== "1") {
        throw new Error(`Etherscan Error: ${result.message} - ${result.result}`);
    }

    let s = <EtherscanSource>(<unknown>result.result[0]);

    if (s.ABI === "Contract source code not verified") {
        throw new Error("Contract source code not verified");
    }

    return {
        source: s.SourceCode,
        abi: JSON.parse(s.ABI),
        contract: s.ContractName,
        compiler: s.CompilerVersion,
        optimized: s.OptimizationUsed !== "0",
        optimizationRuns: Number(s.Runs),
        constructorArgs: s.ConstructorArguments,
    };
}

async function getContractCreationCode(network: string, address: string) {
    let url = `${await getEtherscanUrl(network)}/address/${address}#code`;
    let result = <string>await get(url, {}, null);
    let regex =
        /<div id='verifiedbytecode2'>[\s\r\n]*([0-9a-fA-F]*)[\s\r\n]*<\/div>/g;
    let matches = [...result.matchAll(regex)];
    if (matches.length === 0) {
        console.log('Response is: ', result);
        throw new Error(`Failed to pull deployed contract code from Etherscan: ${url}`);
    }
    return matches[0][1];
}

export async function loadEtherscanContract(network: string, address: string) {
    const apiKey = process.env.ETHERSCAN_KEY;

    const networkName = network;
    let {
        source,
        abi,
        contract,
        compiler,
    } = await getEtherscanApiData(networkName, address, apiKey);
    let contractCreationCode = await getContractCreationCode(
        networkName,
        address
    );
    let encodedABI = JSON.stringify(abi);
    let contractSource = `contracts/${contract}.sol:${contract}`;
    let contractBuild = {
        contracts: {
            [contractSource]: {
                address,
                name: contract,
                abi: encodedABI,
                bin: contractCreationCode,
                metadata: JSON.stringify({
                    compiler: {
                        version: compiler,
                    },
                    language: "Solidity",
                    output: {
                        abi: encodedABI,
                    },
                    devdoc: {},
                    sources: {
                        [contractSource]: {
                            content: source,
                            keccak256: "",
                        },
                    },
                    version: 1,
                }),
            },
        },
        version: compiler,
    };

    return contractBuild;
} 