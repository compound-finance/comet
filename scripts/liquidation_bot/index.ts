import hre from 'hardhat';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  CometInterface,
  Liquidator
} from '../../build/types';
import liquidateUnderwaterBorrowers from './liquidateUnderwaterBorrowers';

const loopDelay = 5000;

async function main() {
  let { DEPLOYMENT: deployment, LIQUIDATOR_ADDRESS: liquidatorAddress } = process.env;
  if (!liquidatorAddress) {
    throw new Error('missing required env variable: LIQUIDATOR_ADDRESS');
  }
  if (!deployment) {
    throw new Error('missing required env variable: DEPLOYMENT');
  }

  const network = hre.network.name;

  const dm = new DeploymentManager(
    network,
    deployment,
    hre,
    {
      writeCacheToDisk: false,
      verificationStrategy: 'eager',
    }
  );
  await dm.spider();

  const signer = await dm.getSigner();
  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

  if (!comet) {
    throw new Error(`no deployed Comet found for ${network}/${deployment}`);
  }

  const liquidator = await hre.ethers.getContractAt(
    'Liquidator',
    liquidatorAddress,
    signer
  ) as Liquidator;

  await liquidateUnderwaterBorrowers(
    comet,
    liquidator,
    signer
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
