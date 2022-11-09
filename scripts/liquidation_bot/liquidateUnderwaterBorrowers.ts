import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  CometInterface,
  Liquidator
} from '../../build/types';

const daiPool = {
  tokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  poolFee: 100
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
      poolFee: daiPool.poolFee
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

async function hasPurchaseableCollateral(comet: CometInterface, assetAddresses: string[]): Promise<boolean> {
  // XXX filter out small amounts
  // XXX refresh cache every day
  for (let asset in assetAddresses) {
    if ((await comet.getCollateralReserves(asset)).gt(0)) {
      return true;
    }
  }
  return false;
}

export async function liquidateUnderwaterBorrowers(
  comet: CometInterface,
  liquidator: Liquidator,
  signer: SignerWithAddress
): Promise<boolean> {
  const uniqueAddresses = await getUniqueAddresses(comet);

  console.log(`${uniqueAddresses.size} unique addresses found`);

  let liquidationAttempted = false;
  for (const address of uniqueAddresses) {
    const isLiquidatable = await comet.isLiquidatable(address);

    console.log(`${address} isLiquidatable=${isLiquidatable}`);

    if (isLiquidatable) {
      await attemptLiquidation(
        liquidator,
        signer,
        [address]
      );
      liquidationAttempted = true;
    }
  }
  return liquidationAttempted;
}

export async function arbitragePurchaseableCollateral(
  comet: CometInterface,
  liquidator: Liquidator,
  signer: SignerWithAddress,
  assetAddresses: string[]
) {
  console.log(`Checking for purchaseable collateral`);

  if (await hasPurchaseableCollateral(comet, assetAddresses)) {
    console.log(`There is purchaseable collateral`);
    await attemptLiquidation(
      liquidator,
      signer,
      [] // empty list means we will only buy collateral and not absorb
    );
  }
}

export async function getAssetAddresses(comet: CometInterface): Promise<string[]> {
  let numAssets = await comet.numAssets();
  let assets = [
    ...await Promise.all(Array(numAssets).fill(0).map(async (_, i) => {
      return (await comet.getAssetInfo(i)).asset;
    })),
  ];
  return assets;
}