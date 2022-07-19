import hre from 'hardhat';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  CometInterface,
  Liquidator
} from '../../build/types';
import liquidateUnderwaterBorrowers from './liquidateUnderwaterBorrowers';

const loopDelay = 5000;

async function main() {
  const liquidatorAddress = process.env.LIQUIDATOR_ADDRESS;

  if (!liquidatorAddress) {
    throw new Error('missing required env variable: LIQUIDATOR_ADDRESS');
  }

  const dm = new DeploymentManager(hre.network.name, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const signer = await dm.getSigner();
  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

  if (!comet) {
    throw new Error(`no deployed Comet found for network: ${hre.network.name}`);
  }

  const liquidator = await hre.ethers.getContractAt(
    "Liquidator",
    liquidatorAddress,
    signer
  ) as Liquidator;

  let lastBlockNumber: number;

  while (true) {
    const currentBlockNumber = await hre.ethers.provider.getBlockNumber();

    console.log(`currentBlockNumber: ${currentBlockNumber}`);

    if (currentBlockNumber !== lastBlockNumber) {
      lastBlockNumber = currentBlockNumber;
      await liquidateUnderwaterBorrowers(
        comet,
        liquidator,
        signer
      );
    } else {
      console.log(`block already checked; waiting ${loopDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, loopDelay));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
