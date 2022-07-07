import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  CometInterface,
  Liquidator
} from '../../build/types';

// XXX this is Kovan-specific
const daiPool = {
  tokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
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

export default async function liquidateUnderwaterBorrowers(
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