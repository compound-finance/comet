// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre, { ethers } from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  Configurator,
} from '../build/types';
import { ConfigurationStruct } from '../build/types/CometFactory';

const delay = ms => new Promise(res => setTimeout(res, ms));

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
 * Deploys the latest version of `Comet` and verifies it on Etherscan. 
 * 
 * This gets around the issue of Etherscan not being able to verify contracts deployed by another contract 
 * (e.g. `CometFactory`) by deploying another contract with the exact same bytecode via an EOA and verifying 
 * that instead.
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

  let signers = await dm.hre.ethers.getSigners();
  let admin = await signers[0];
  
  // XXX move to command line, which requires this to be a Hardhat task since HH scripts can't take user arguments
  let configuratorAddress = "0x62f5a823efcd2bac5df35141acccd2099cc83b72";
  let configurator = (await ethers.getContractAt("Configurator", configuratorAddress, admin)) as Configurator;
  let config: ConfigurationStruct = await configurator.getConfiguration();
  console.log("Latest configuration is: ", config)

  // Deploy Comet with latest configuration
  const comet = await dm.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
    'Comet.sol',
    [config]
  );
  console.log('Comet deployed at ', comet.address)

  console.log('Waiting 1 min before verification')
  await delay(60000);

  console.log('Starting verification!')

  await verifyContract(comet.address, [config]);

  console.log('Finished verification!')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
