import { Comet } from '../../build/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { FakeContract } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

/*
Absorption Bot

To run: `yarn hardhat absorption-bot --network kovan`
*/

type CometOrMock = Comet | FakeContract<Comet>;

function debug(shouldLog: boolean, message?, ...optionalParams) {
  if (shouldLog) {
    console.log(message, optionalParams);
  }
}

async function attemptAbsorb(comet: CometOrMock, absorber: SignerWithAddress, targetAddresses: string[], log = false) {
  try {
    await comet.connect(absorber).absorb(absorber.address, targetAddresses);
    debug(log, `Successfully absorbed ${targetAddresses}`);
  } catch (e) {
    debug(log, `Failed to absorb ${targetAddresses}`);
    debug(log, e.message);
  }
}

async function getUniqueAddresses(comet: CometOrMock): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  return new Set(withdrawEvents.map(event => event.args.src));
}

export async function absorbLiquidatableBorrowers(comet: CometOrMock, absorber: SignerWithAddress, log = false) {
  const uniqueAddresses = await getUniqueAddresses(comet);

  debug(log, `${uniqueAddresses.size} unique addresses found`);

  for (const address of uniqueAddresses) {
    const liquidationMargin = await comet.getLiquidationMargin(address);

    debug(log, `${address} liquidation margin=${liquidationMargin}`);

    if (liquidationMargin.lt(0)) {
      await attemptAbsorb(comet, absorber, [address], log);
    }
  }
}

async function main({ hre, debug = true }) {
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

  while (true) {
    await absorbLiquidatableBorrowers(comet, absorber, debug);
  }
}

export default main;