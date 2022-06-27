// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { CometInterface, Configurator } from '../build/types';
import { ConfigurationStruct } from '../build/types/CometFactory';

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
  await hre.run('compile');
  let isDevelopment = hre.network.name === 'hardhat';
  let dm = new DeploymentManager(hre.network.name, hre, {
    writeCacheToDisk: true,
    verifyContracts: !isDevelopment,
    debug: true,
  });

  const comet = await dm.contract('comet') as CometInterface;
  const configurator = await dm.contract('configurator') as Configurator;
  let config: ConfigurationStruct = await configurator.getConfiguration(comet.address);
  console.log('Latest configuration is: ', config);
  console.log('Starting verification!');

  // XXX move to command line, which requires this to be a Hardhat task since HH scripts can't take user arguments
  const cometAddress = '0x3F6Faa0Bd3506F8C7d5f2D50cD364d47290D23Fc';
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
