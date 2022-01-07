// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat';
import { deployComet } from '../src/deploy';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';

async function main() {
  await hre.run('compile');
  let isDevelopment = hre.network.name === 'hardhat';
  let dm = new DeploymentManager(hre.network.name, hre, {
    writeCacheToDisk: true,
    verifyContracts: !isDevelopment,
    debug: true,
  });
  let { comet } = await deployComet(dm);
  await dm.spider();
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
