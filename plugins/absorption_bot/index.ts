import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Contract } from 'ethers';

function debug(shouldLog: boolean, message?, ...optionalParams) {
  if (shouldLog) {
    console.log(message, optionalParams);
  }
}

async function attemptAbsorb(comet: Contract, absorber: SignerWithAddress, targetAddresses: string[], log = false) {
  try {
    await comet.connect(absorber).absorb(absorber.address, targetAddresses);
    debug(log, `Successfully absorbed ${targetAddresses}`);
  } catch (e) {
    debug(log, `Failed to absorb ${targetAddresses}`);
    debug(log, e.message);
  }
}

async function getUniqueAddresses(comet: Contract): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  return new Set(withdrawEvents.map(event => event.args.src));
}

export async function absorbLiquidatableBorrowers(comet: Contract, absorber: SignerWithAddress, log = false) {
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

async function main({ hre, log = true, loopDelay = 0 }) {
  const network = hre.network.name;
  const [absorber] = await hre.ethers.getSigners();

  const dm = new DeploymentManager(network, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet');

  while (true) {
    await absorbLiquidatableBorrowers(comet, absorber, log);

    if (loopDelay) {
      debug(log, `waiting ${loopDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, loopDelay));
    }
  }
}

export default main;