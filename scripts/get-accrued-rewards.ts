import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
// import { CometInterface } from '../build/types';

// pull in all addresses that have supplied or borrowed base asset from Comet
// async function getUniqueAddresses(comet: CometInterface): Promise<Set<string>> {
//   const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
//   return new Set(withdrawEvents.map(event => event.args.src));
// }

async function main() {

  // TODO: move network and deployment into env vars
  const dm = new DeploymentManager('goerli', 'weth', hre);

  // await dm.spider();
  // const comet = await dm.contract('comet') as CometInterface;
  // const rewards = await dm.contract('rewards');

  // const uniqueAddresses = await getUniqueAddresses(comet);

  // for (const address of uniqueAddresses) {
  //   const rewardsOwed = rewards.getRewardsOwed(address);
  // }

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
