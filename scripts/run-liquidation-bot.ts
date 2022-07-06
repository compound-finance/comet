import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import {
  CometInterface,
  Liquidator
} from '../build/types';

// deploy_liquidator_contract migration?

// async function getUniqueAddresses(comet: Contract): Promise<Set<string>> {
//   const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
//   return new Set(withdrawEvents.map(event => event.args.src));
// }

async function main() {
  const network = hre.network.name;
  const [absorber] = await hre.ethers.getSigners();

  const dm = new DeploymentManager(network, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;
  const liquidator = contracts.get('liquidator') as Liquidator;

  console.log(`liquidator.address: ${liquidator.address}`);

  // while (true) {
  //   console.log(`loop`);
  // }

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
