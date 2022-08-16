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
  const config: ConfigurationStruct = await configurator.getConfiguration(comet.address);

  const numAssets = await comet.numAssets();
  for (let i = 0; i < numAssets; i++) {
    const config = await comet.getAssetInfo(i);
    console.log('Config for asset #', i)
    console.log(config.map(x => {
      if (typeof x === 'object') return x.toBigInt();
      return x;
    }));
  }
  console.log('totals basic ', (await comet.totalsBasic()).map(x => {
    if (typeof x === 'object') return x.toBigInt();
    return x;
  }))
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
