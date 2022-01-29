import * as fs from 'fs/promises';
import { Contract, ContractFactory, Signer } from 'ethers';
import { ContractMetadata, BuildFile } from './Types';
import { getPrimaryContract } from './Utils';
import { NomicLabsHardhatPluginError } from 'hardhat/plugins';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import {
  toCheckStatusRequest,
  toVerifyRequest,
} from '@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanVerifyContractRequest';
import {
  delay,
  getVerificationStatus,
  verifyContract,
} from '@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanService';
import { resolveEtherscanApiKey } from '@nomiclabs/hardhat-etherscan/dist/src/resolveEtherscanApiKey';

// Note: We copied as much of this as possible from `hardhat-etherscan`
// Hence why it doesn't match our styles.
// Original source code: https://github.com/nomiclabs/hardhat/blob/d07e145222d6e2e465daa841d6355632ad6bc2cd/packages/hardhat-etherscan/src/index.ts#L423
export async function manualVerifyContract(
  contract: Contract,
  buildFile: BuildFile,
  deployArgs: any[],
  hre: HardhatRuntimeEnvironment
) {
  let [contractName, contractMetadata] = getPrimaryContract(buildFile);

  const { network: verificationNetwork, urls: etherscanAPIEndpoints } = await hre.run(
    'verify:get-etherscan-endpoint'
  );

  const etherscanAPIKey = resolveEtherscanApiKey(hre.config.etherscan, verificationNetwork);
  let contractAddress = contract.address.toLowerCase();
  let sourceName = contractMetadata.source;
  let metadata = JSON.parse(contractMetadata.metadata);
  let compilerVersion = metadata.compiler.version.replace(
    /\+commit\.([0-9a-fA-F]+)\..*/gi,
    '+commit.$1'
  );
  let language = metadata.language;
  let sources = metadata.sources;
  let settings = metadata.settings;

  // Fix up some settings issues

  // First, remove 'compilationTarget' if it exists
  if (metadata.settings.hasOwnProperty('compilationTarget')) {
    delete metadata.settings['compilationTarget'];
  }

  // Second, cap optimizer runs to 1MM
  if (settings.optimizer && settings.optimizer.runs && settings.optimizer.runs > 1000000) {
    settings.optimizer.runs = 1000000;
  }

  let request = toVerifyRequest({
    apiKey: etherscanAPIKey,
    contractAddress,
    sourceCode: JSON.stringify({ language, settings, sources }),
    sourceName,
    contractName,
    compilerVersion,
    constructorArguments: contractMetadata.constructorArgs,
  });

  // Since verification can fail for so many reasons; a simple logging approach for debugging
  if (process.env['DEBUG_VERIFY']) {
    console.log({ request });
    await fs.writeFile(`sources-${contractAddress}.json`, request.sourceCode);
  }
  const response = await verifyContract(etherscanAPIEndpoints.apiURL, request);

  console.log(
    `Successfully submitted source code for contract
${sourceName}:${contractName} at ${contractAddress}
for verification on the block explorer. Waiting for verification result...
`
  );

  const pollRequest = toCheckStatusRequest({
    apiKey: etherscanAPIKey,
    guid: response.message,
  });

  // Compilation is bound to take some time so there's no sense in requesting status immediately.
  await delay(700);
  const verificationStatus = await getVerificationStatus(etherscanAPIEndpoints.apiURL, pollRequest);

  if (verificationStatus.isVerificationFailure()) {
    throw new NomicLabsHardhatPluginError(
      'DeploymentManager',
      `The API responded with a failure message.
  Message: ${verificationStatus.message}`,
      undefined,
      true
    );
  }

  if (!verificationStatus.isVerificationSuccess()) {
    // Reaching this point shouldn't be possible unless the API is behaving in a new way.
    throw new NomicLabsHardhatPluginError(
      'DeploymentManager',
      `The API responded with an unexpected message.
  Contract verification may have succeeded and should be checked manually.
  Message: ${verificationStatus.message}`,
      undefined,
      true
    );
  }
}
