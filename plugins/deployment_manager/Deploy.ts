import * as path from 'path';
import * as fs from 'fs/promises';

import { Contract, Signer } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { putAlias } from './Aliases';
import { putVerifyArgs } from './VerifyArgs';
import { Cache } from './Cache';
import { storeBuildFile } from './ContractMap';
import { Alias, BuildFile } from './Types';
import { debug, getPrimaryContract } from './Utils';
import { VerifyArgs, verifyContract } from './Verify';

export abstract class Deployer<Contract, DeployArgs extends Array<any>> {
  abstract connect(signer: Signer): this;
  abstract deploy(...args: DeployArgs): Promise<Contract>;
}

export interface DeployOpts {
  name?: string; // name for aliasing
  overwrite?: boolean; // should we overwrite existing contract link
  connect?: Signer; // signer for the returned contract
  verify?: boolean; // verify contract on etherscan
  lazyVerify?: boolean; // delay verification: can prevent flakiness of deployments
  raiseOnVerificationFailure?: boolean; // if verification is considered critical
  cache?: Cache; // caches the build file, if included
  alias?: Alias; // set an alias for the contract and store in cache
}

// Deploys a contract given a build file (e.g. something imported or spidered)
async function deployFromBuildFile(
  buildFile: BuildFile,
  deployArgs: any[],
  hre: HardhatRuntimeEnvironment,
  deployOpts: DeployOpts = {}
): Promise<Contract> {
  let [contractName, metadata] = getPrimaryContract(buildFile);
  const [ethersSigner] = await hre.ethers.getSigners();
  const signer = deployOpts.connect ?? ethersSigner;
  const contractFactory = new hre.ethers.ContractFactory(metadata.abi, metadata.bin, signer);
  const contract = await contractFactory.deploy(...deployArgs);
  const deployed = await contract.deployed();
  debug(`Deployed ${contractName}`);
  return deployed;
}

async function maybeStoreCache(deployOpts: DeployOpts, contract: Contract, buildFile: BuildFile) {
  if (deployOpts.cache) {
    await storeBuildFile(deployOpts.cache, contract.address, buildFile);

    if (deployOpts.alias) {
      await putAlias(deployOpts.cache, deployOpts.alias, contract.address);
    }
  }
}

async function getBuildFileFromArtifacts(
  contractFile: string,
  contractFileName: string
): Promise<BuildFile> {
  // We should be able to get the artifact, even if it's going to be a little hacky
  // TODO: Check sub-pathed files
  let debugFile = path.join(
    process.cwd(),
    'artifacts',
    'contracts',
    contractFile,
    contractFileName.replace('.sol', '.dbg.json')
  );
  let { buildInfo } = JSON.parse(await fs.readFile(debugFile, 'utf8')) as { buildInfo: string };
  let { output: buildFile } = JSON.parse(
    await fs.readFile(path.join(debugFile, '..', buildInfo), 'utf8')
  ) as {
    output: BuildFile;
  };

  return buildFile;
}

/**
 * Deploys a contract from hardhat artifacts
 */
export async function deploy<
  C extends Contract,
  Factory extends Deployer<C, DeployArgs>,
  DeployArgs extends Array<any>
>(
  contractFile: string,
  deployArgs: DeployArgs,
  hre: HardhatRuntimeEnvironment,
  deployOpts: DeployOpts = {}
): Promise<C> {
  let contractFileName = contractFile.split('/').reverse()[0];
  let contractName = contractFileName.replace('.sol', '');
  let factory = (await hre.ethers.getContractFactory(contractName)) as unknown as Factory;
  if (deployOpts.connect) {
    factory = factory.connect(deployOpts.connect);
  }

  debug(`Deploying ${contractName} with args`, deployArgs);

  let contract = await factory.deploy(...deployArgs);
  await contract.deployed();

  let buildFile = await getBuildFileFromArtifacts(contractFile, contractFileName);

  if (!buildFile.contract) {
    // This is just to make it clear which contract was deployed, when reading the build file
    buildFile.contract = contractName;
  }

  let verifyArgs: VerifyArgs = {
    via: 'artifacts',
    address: contract.address,
    constructorArguments: deployArgs,
  };
  if (deployOpts.lazyVerify) {
    // Cache params for verification
    await putVerifyArgs(deployOpts.cache, contract.address, verifyArgs);
  } else if (deployOpts.verify) {
    await verifyContract(
      verifyArgs,
      hre,
      deployOpts.raiseOnVerificationFailure
    );
  }

  await maybeStoreCache(deployOpts, contract, buildFile);

  debug(`Deployed ${contractName} via tx ${contract.deployTransaction?.hash}`);

  return contract;
}

/**
 * Deploy a new contract from a build file, e.g. something imported or crawled
 */
export async function deployBuild(
  buildFile: BuildFile,
  deployArgs: any[],
  hre: HardhatRuntimeEnvironment,
  deployOpts: DeployOpts = {}
): Promise<Contract> {
  debug(`Deploying ${Object.keys(buildFile.contracts)} with args`, deployArgs);

  let contract = await deployFromBuildFile(buildFile, deployArgs, hre, deployOpts);

  let verifyArgs: VerifyArgs = {
    via: 'buildfile',
    contract,
    buildFile,
    deployArgs
  };
  if (deployOpts.lazyVerify) {
    // Cache params for verification
    await putVerifyArgs(deployOpts.cache, contract.address, verifyArgs);
  } else if (deployOpts.verify) {
    // We need to do manual verification here, since this is coming
    // from a build file, not from hardhat's own compilation.
    await verifyContract(
      verifyArgs,
      hre,
      deployOpts.raiseOnVerificationFailure
    );
  }

  await maybeStoreCache(deployOpts, contract, buildFile);

  return contract;
}
