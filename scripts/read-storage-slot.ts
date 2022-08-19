// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre, { ethers } from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { CometInterface, Configurator } from '../build/types';
import { ConfigurationStruct } from '../build/types/CometFactory';
import { throwIfMissing } from '../hardhat.config';
import { BigNumber, utils } from 'ethers';

/**
 * Verifies an unverified version of `Comet` on Etherscan.
 *
 * Note: The Comet source code in this repo MUST match the Comet deployed on-chain. If not, verification will
 * fail.
 */
async function main() {
  console.log('running!')

  const { DEPLOYMENT: deployment } = process.env;
  throwIfMissing(deployment, 'missing required env variable: DEPLOYMENT');

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
  const slot = '0x1';
  const paddedSlot = utils.hexZeroPad(slot, 32);
  const paddedAddress = utils.hexZeroPad(comet.address, 32);
  const concatenated = utils.concat([paddedAddress, paddedSlot]);
  const hash = utils.keccak256(concatenated);

  console.log(await ethers.provider.getStorageAt(configurator.address, hash));
  const offset = 9n;
  const targetReserves = utils.hexlify(BigInt(hash) + offset);
  console.log(await ethers.provider.getStorageAt(configurator.address, targetReserves));
  const offsetStruct = 10n; // ARRAY...gives length of 5
  const struct = utils.hexlify(BigInt(hash) + offsetStruct);
  console.log(await ethers.provider.getStorageAt(configurator.address, struct));

  // const offsetFirstAsset = offsetStruct + 1n;
  // const firstAsset = utils.hexlify(BigInt(hash) + offsetFirstAsset); // XXX need to hash this
  const hashedStruct = utils.keccak256(struct);
  const firstAssetStructAddr = await ethers.provider.getStorageAt(configurator.address, hashedStruct);
  console.log(firstAssetStructAddr);

  const secondAsset = utils.hexlify(BigInt(hashedStruct) + 1n); // XXX need to hash this
  const secondAssetStructAddr = await ethers.provider.getStorageAt(configurator.address, secondAsset);
  console.log(secondAssetStructAddr);
  // console.log(await ethers.provider.getStorageAt(configurator.address, firstAssetStructAddr));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
