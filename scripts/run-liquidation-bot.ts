import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  CometInterface,
  Liquidator
} from '../build/types';

// XXX this is Kovan-specific
const daiPool = {
  tokenAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  poolFee: 500,
  reversedPair: false
};

async function attemptLiquidation(
  liquidator: Liquidator,
  signer: SignerWithAddress,
  targetAddresses: string[]
) {
  try {
    await liquidator.connect(signer).initFlash({
      accounts: targetAddresses,
      pairToken: daiPool.tokenAddress,
      poolFee: daiPool.poolFee,
      reversedPair: daiPool.reversedPair
    });
    console.log(`Successfully liquidated ${targetAddresses}`);
  } catch (e) {
    console.log(`Failed to liquidate ${targetAddresses}`);
    console.log(e.message);
  }
}

async function getUniqueAddresses(comet: CometInterface): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  return new Set(withdrawEvents.map(event => event.args.src));
}

export async function liquidateUnderwaterBorrowers(
  comet: CometInterface,
  liquidator: Liquidator,
  signer: SignerWithAddress
) {
  const uniqueAddresses = await getUniqueAddresses(comet);

  console.log(`${uniqueAddresses.size} unique addresses found`);

  for (const address of uniqueAddresses) {
    const isLiquidatable = await comet.isLiquidatable(address);

    console.log(`${address} isLiquidatble=${isLiquidatable}`);

    if (isLiquidatable) {
      await attemptLiquidation(
        liquidator,
        signer,
        [address]
      );
    }
  }
}

const loopDelay = 5000;

async function main() {
  const dm = new DeploymentManager(hre.network.name, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const signer = await dm.getSigner();
  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;
  const liquidator = contracts.get('liquidator') as Liquidator;

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
