import { Comet } from '../../build/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { FakeContract } from '@defi-wonderland/smock';

/*
Absorption Bot

To run: `yarn hardhat absorption-bot --network kovan`
*/

type CometOrMock = Comet | FakeContract<Comet>;

async function getUniqueAddresses(comet: CometOrMock): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  console.log(withdrawEvents);
  return new Set(withdrawEvents.map(event => event.args.src));
}

export async function absorbLiquidatableBorrowers(comet: CometOrMock) {
  const uniqueAddresses = await getUniqueAddresses(comet);
  console.log(uniqueAddresses);
}

async function main({ hre }) {
  const network = hre.network.name;
  const [absorber] = await hre.ethers.getSigners();

  const dm = new DeploymentManager(network, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as Comet;

  await absorbLiquidatableBorrowers(comet);

  // while (true) {
  //   absorbLiquidtableBorrowers(comet);
  // }

}

export default main;