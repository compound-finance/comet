import * as path from 'path';
import * as fs from 'fs/promises';

import { Contract, Signer } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { putVerifyArgs } from './VerifyArgs';
import { Cache } from './Cache';
import { storeBuildFile } from './ContractMap';
import { BuildFile } from './Types';
import { debug, getPrimaryContract } from './Utils';
import { VerifyArgs, verifyContract, VerificationStrategy } from './Verify';

export abstract class Deployer<Contract, DeployArgs extends Array<any>> {
  abstract connect(signer: Signer): this;
  abstract deploy(...args: DeployArgs): Promise<Contract>;
}

export interface DeployOpts {
  network: string; // the real name of the network we would actually or hypothetically deploy on
  overwrite?: boolean; // should we overwrite existing contract link
  connect?: Signer; // signer for the returned contract
  verificationStrategy?: VerificationStrategy; // strategy for verifying contracts on etherscan
  raiseOnVerificationFailure?: boolean; // if verification is considered critical
  cache?: Cache; // caches the build file, if included
}

// Deploys a contract given a build file (e.g. something imported or spidered)
async function deployFromBuildFile<C extends Contract>(
  buildFile: BuildFile,
  deployArgs: any[],
  hre: HardhatRuntimeEnvironment,
  deployOpts: DeployOpts
): Promise<C> {
  let [contractName, metadata] = getPrimaryContract(buildFile);
  const [ethersSigner] = await hre.ethers.getSigners();
  const signer = deployOpts.connect ?? ethersSigner;
  const contractFactory = new hre.ethers.ContractFactory(metadata.abi, metadata.bin, signer);
  debug(`Deploying ${Object.keys(buildFile.contracts)} with args`, deployArgs);
  const contract = await contractFactory.deploy(...deployArgs);
  const deployed = await contract.deployed();
  debug(`Deployed ${contractName} @ ${contract.address}`);
  return deployed as C;
}

async function maybeStoreCache(deployOpts: DeployOpts, contract: Contract, buildFile: BuildFile) {
  if (deployOpts.cache) {
    await storeBuildFile(deployOpts.cache, deployOpts.network, contract.address, buildFile);
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
  deployOpts: DeployOpts
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

  debug(`Deployed ${contractName} via tx ${contract.deployTransaction?.hash} @ ${contract.address}`);

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
  if (deployOpts.verificationStrategy === 'lazy') {
    // Cache params for verification
    await putVerifyArgs(deployOpts.cache, contract.address, verifyArgs);
  } else if (deployOpts.verificationStrategy === 'eager') {
    await verifyContract(
      verifyArgs,
      hre,
      deployOpts.raiseOnVerificationFailure
    );
  }

  await maybeStoreCache(deployOpts, contract, buildFile);

  return contract;
}

/**
 * Deploy a new contract from a build file, e.g. something imported or crawled
 */
export async function deployBuild<C extends Contract>(
  buildFile: BuildFile,
  deployArgs: any[],
  hre: HardhatRuntimeEnvironment,
  deployOpts: DeployOpts
): Promise<C> {
  debug(`Deploying ${Object.keys(buildFile.contracts)} with args`, deployArgs);

  let contract: C = await deployFromBuildFile(buildFile, deployArgs, hre, deployOpts);

  let verifyArgs: VerifyArgs = {
    via: 'buildfile',
    contract,
    buildFile,
    deployArgs
  };
  if (deployOpts.verificationStrategy === 'lazy') {
    // Cache params for verification
    await putVerifyArgs(deployOpts.cache, contract.address, verifyArgs);
  } else if (deployOpts.verificationStrategy === 'eager') {
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
