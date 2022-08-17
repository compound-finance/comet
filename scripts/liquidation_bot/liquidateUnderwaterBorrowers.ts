import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  CometInterface,
  Liquidator
} from '../../build/types';

const linkPool = {
  tokenAddress: '0xb6d2505de375ec39d906e61e3d7acd5a55ab9994',
  poolFee: 10000
};

async function attemptLiquidation(
  liquidator: Liquidator,
  signer: SignerWithAddress,
  targetAddresses: string[]
) {
  try {
    await liquidator.connect(signer).initFlash({
      accounts: targetAddresses,
      pairToken: linkPool.tokenAddress,
      poolFee: linkPool.poolFee
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

    console.log(`${address} isLiquidatable=${isLiquidatable}`);

    if (isLiquidatable) {
      await attemptLiquidation(
        liquidator,
        signer,
        [address]
      );
    }
  }
}