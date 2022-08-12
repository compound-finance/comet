// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { CometInterface, Configurator } from '../build/types';
import { ConfigurationStruct } from '../build/types/CometFactory';
import { throwIfMissing } from '../hardhat.config';

async function verifyContract(address: string, constructorArguments) {
  try {
    return await hre.run('verify:verify', {
      address,
      constructorArguments,
    });
  } catch (e) {
    const regex = /Already Verified/i;
    const result = e.message.match(regex);
    if (result) {
      console.log(
        'Contract at address ' + address + ' is already verified on Etherscan'
      );
      return;
    }
    throw e;
  }
}

/**
 * Verifies an unverified version of `Comet` on Etherscan.
 *
 * Note: The Comet source code in this repo MUST match the Comet deployed on-chain. If not, verification will
 * fail.
 */
async function main() {
  const { DEPLOYMENT: deployment, COMET_ADDRESS: cometAddress } = process.env;
  throwIfMissing(deployment, 'missing required env variable: DEPLOYMENT');
  throwIfMissing(cometAddress, 'missing required env variable: COMET_ADDRESS');

  await hre.run('compile');
  const network = hre.network.name;
  const isDevelopment = network === 'hardhat';
  const dm = new DeploymentManager(
    network,
    deployment,
    hre,
    {
      writeCacheToDisk: true,
      verificationStrategy: isDevelopment ? 'eager' : 'none',
    }
  );

  const comet = await dm.contract('comet') as CometInterface;
  const configurator = await dm.contract('configurator') as Configurator;
  const config: ConfigurationStruct = await configurator.getConfiguration(comet.address);
  console.log('Latest configuration is: ', config);
  console.log('Starting verification!');

  await verifyContract(cometAddress, [config]);

  console.log('Finished verification!');
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
