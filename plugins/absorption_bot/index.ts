import { Comet } from '../../build/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { FakeContract } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

/*
Absorption Bot

To run: `yarn hardhat absorption-bot --network kovan`
*/

type CometOrMock = Comet | FakeContract<Comet>;

async function getUniqueAddresses(comet: CometOrMock): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  return new Set(withdrawEvents.map(event => event.args.src));
}

export async function absorbLiquidatableBorrowers(comet: CometOrMock, absorber: SignerWithAddress) {
  const uniqueAddresses = await getUniqueAddresses(comet);
  for (const address of uniqueAddresses) {
    try {
      const liquidationMargin = await comet.getLiquidationMargin(address);
      console.log(`${address} liquidation margin=${liquidationMargin}`)
      if (liquidationMargin.lt(0)) {
        await comet.connect(absorber).absorb(absorber.address, [address]);
      }
    } catch (error) {
      console.log(error.message)
    }
  }
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

  // await absorbLiquidatableBorrowers(comet, absorber);

  while (true) {
    await absorbLiquidatableBorrowers(comet, absorber);
  }

}

export default main;