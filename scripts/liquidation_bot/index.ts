import hre from 'hardhat';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  CometInterface,
  Liquidator
} from '../../build/types';
import {
  arbitragePurchaseableCollateral,
  liquidateUnderwaterBorrowers,
  getAssets,
  Asset
} from './liquidateUnderwaterBorrowers';

const loopDelay = 5000;
const updateAssetsDelay = 86_400_000; // 1 day
let assets: Asset[] = [];

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

  let lastBlockNumber: number;
  let loopsUntilUpdateAssets = updateAssetsDelay / loopDelay;
  while (true) {
    loopsUntilUpdateAssets -= 1;
    if (loopsUntilUpdateAssets <= 0) {
      console.log('Updating asset addresses');
      assets = await getAssets(comet);
      loopsUntilUpdateAssets = updateAssetsDelay / loopDelay;
    }

    const currentBlockNumber = await hre.ethers.provider.getBlockNumber();

    console.log(`currentBlockNumber: ${currentBlockNumber}`);

    if (currentBlockNumber !== lastBlockNumber) {
      lastBlockNumber = currentBlockNumber;
      const liquidationAttempted = await liquidateUnderwaterBorrowers(
        comet,
        liquidator,
        signer
      );
      if (!liquidationAttempted) {
        await arbitragePurchaseableCollateral(
          comet,
          liquidator,
          signer,
          assets
        );
      }
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
