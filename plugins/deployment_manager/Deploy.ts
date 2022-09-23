import * as path from 'path';
import * as fs from 'fs/promises';

import { Contract, ContractFactory, Signer } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { putVerifyArgs } from './VerifyArgs';
import { Cache } from './Cache';
import { storeBuildFile } from './ContractMap';
import { BuildFile, TraceFn } from './Types';
import { debug, getPrimaryContract, stringifyJson } from './Utils';
import { VerifyArgs, verifyContract, VerificationStrategy } from './Verify';

export interface DeployOpts {
  cache?: Cache; // caches the build file, if included
  connect?: Signer; // signer for the returned contract
  network: string; // the real name of the network we would actually or hypothetically deploy on
  overwrite?: boolean; // should we overwrite existing contract link
  raiseOnVerificationFailure?: boolean; // if verification is considered critical
  trace?: TraceFn; // the trace fn to use
  verificationStrategy?: VerificationStrategy; // strategy for verifying contracts on etherscan
}

async function doDeploy<C extends Contract>(
  name: string,
  factory: ContractFactory,
  args: any[],
  opts: DeployOpts,
  src: string
): Promise<C> {
  const trace = opts.trace ?? debug;
  trace(`Deploying ${name} with args ${stringifyJson(args)} via ${src}`);
  const contract = await factory.deploy(...args);
  await contract.deployed();
  trace(contract.deployTransaction, `Deployed ${name} @ ${contract.address}`);
  return contract as C;
}

// Deploys a contract given a build file (e.g. something imported or spidered)
async function deployFromBuildFile<C extends Contract>(
  buildFile: BuildFile,
  deployArgs: any[],
  hre: HardhatRuntimeEnvironment,
  deployOpts: DeployOpts
): Promise<C> {
  const [contractName, metadata] = getPrimaryContract(buildFile);
  const [ethersSigner] = await hre.ethers.getSigners();
  const signer = deployOpts.connect ?? ethersSigner;
  const factory = new hre.ethers.ContractFactory(metadata.abi, metadata.bin, signer);
  return doDeploy(contractName, factory, deployArgs, deployOpts, 'build file');
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
  const debugFile = path.join(
    process.cwd(),
    'artifacts',
    'contracts',
    contractFile,
    contractFileName.replace('.sol', '.dbg.json')
  );
  const { buildInfo } = JSON.parse(await fs.readFile(debugFile, 'utf8')) as { buildInfo: string };
  const { output: buildFile } = JSON.parse(
    await fs.readFile(path.join(debugFile, '..', buildInfo), 'utf8')
  ) as { output: BuildFile };

  return buildFile;
}

/**
 * Deploys a contract from hardhat artifacts
 */
export async function deploy<C extends Contract>(
  contractFile: string,
  deployArgs: any[],
  hre: HardhatRuntimeEnvironment,
  deployOpts: DeployOpts
): Promise<C> {
  const contractFileName = contractFile.split('/').reverse()[0];
  const contractName = contractFileName.replace('.sol', '');
  let factory = (await hre.ethers.getContractFactory(contractName));
  if (deployOpts.connect) {
    factory = factory.connect(deployOpts.connect);
  }

  const contract = await doDeploy(contractName, factory, deployArgs, deployOpts, 'artifact');
  const buildFile = await getBuildFileFromArtifacts(contractFile, contractFileName);
  if (!buildFile.contract) {
    // This is just to make it clear which contract was deployed, when reading the build file
    buildFile.contract = contractName;
  }

  const verifyArgs: VerifyArgs = {
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

  return contract as C;
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
  const contract: C = await deployFromBuildFile(buildFile, deployArgs, hre, deployOpts);
  const verifyArgs: VerifyArgs = {
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
