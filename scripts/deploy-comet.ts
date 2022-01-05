// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat';
import { deploy } from '../src/comet';
import {
  DeploymentManager,
  Roots,
} from '../plugins/deployment_manager/DeploymentManager';

async function main() {
  let isDevelopment = hre.network.name === 'hardhat';

  // TODO: When to verify? Configuration-type params?
  let { comet } = await deploy(hre, !isDevelopment);

  // TODO: If we deployed fresh, we probably don't need to spider, per se. We should work on passing a deployment manager into deploy!

  // Create a `roots.json` pointing to a just deployed contract and run spider on it.

  // TODO: Worth doing this for development?
  if (!isDevelopment) {
    let dm = new DeploymentManager(hre.network.name, hre, {
      writeCacheToDisk: true,
    });
    await dm.writeRootsFileToCache({ Comet: comet.address } as Roots);
    await dm.spider();
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
