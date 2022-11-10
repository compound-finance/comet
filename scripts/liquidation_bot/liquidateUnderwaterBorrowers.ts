import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  CometInterface,
  Liquidator
} from '../../build/types';
import { exp } from '../../test/helpers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import { PopulatedTransaction } from 'ethers';
import googleCloudLog, { LogSeverity } from './googleCloudLog';

export interface SignerWithFlashbots {
  signer: SignerWithAddress;
  flashbotsProvider?: FlashbotsBundleProvider;
}

export interface Asset {
  address: string;
  priceFeed: string;
  scale: bigint;
}

const daiPool = {
  tokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  poolFee: 100
};

async function sendFlashbotsPrivateTransaction(
  txn: PopulatedTransaction,
  flashbotsProvider: FlashbotsBundleProvider
) {
  const privateTx = {
    transaction: txn,
    signer: flashbotsProvider.getSigner(),
  };
  await flashbotsProvider.sendPrivateTransaction(privateTx);
}

async function sendTxn(
  txn: PopulatedTransaction,
  signerWithFlashbots: SignerWithFlashbots
) {
  if (signerWithFlashbots.flashbotsProvider) {
    googleCloudLog(LogSeverity.INFO, 'Sending a private txn');
    await sendFlashbotsPrivateTransaction(txn, signerWithFlashbots.flashbotsProvider);
  } else {
    googleCloudLog(LogSeverity.INFO, 'Sending a public txn');
    await signerWithFlashbots.signer.sendTransaction(txn);
  }
}

async function attemptLiquidation(
  liquidator: Liquidator,
  targetAddresses: string[],
  signerWithFlashbots: SignerWithFlashbots
) {
  try {
    googleCloudLog(LogSeverity.INFO, `Attempting to liquidate ${targetAddresses} via ${liquidator.address}`);
    const txn = await liquidator.populateTransaction.initFlash({
      accounts: targetAddresses,
      pairToken: daiPool.tokenAddress,
      poolFee: daiPool.poolFee
    });
    await sendTxn(txn, signerWithFlashbots);
    googleCloudLog(LogSeverity.INFO, `Successfully liquidated ${targetAddresses} via ${liquidator.address}`);
  } catch (e) {
    googleCloudLog(
      LogSeverity.ALERT,
      `Failed to liquidate ${targetAddresses} via ${liquidator.address}: ${e.message}`
    );
  }
}

async function getUniqueAddresses(comet: CometInterface): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  return new Set(withdrawEvents.map(event => event.args.src));
}

export async function hasPurchaseableCollateral(comet: CometInterface, assets: Asset[], minUsdValue: number = 100): Promise<boolean> {
  let totalValue = 0n;
  const minValue = exp(minUsdValue, 8);
  for (const asset of assets) {
    const collateralReserves = await comet.getCollateralReserves(asset.address);
    const price = await comet.getPrice(asset.priceFeed);
    totalValue += collateralReserves.toBigInt() * price.toBigInt() / asset.scale;
    if (totalValue >= minValue) {
      return true;
    }
  }
  return false;
}

export async function liquidateUnderwaterBorrowers(
  comet: CometInterface,
  liquidator: Liquidator,
  signerWithFlashbots: SignerWithFlashbots
): Promise<boolean> {
  const uniqueAddresses = await getUniqueAddresses(comet);

  googleCloudLog(LogSeverity.INFO, `${uniqueAddresses.size} unique addresses found`);

  let liquidationAttempted = false;
  for (const address of uniqueAddresses) {
    const isLiquidatable = await comet.isLiquidatable(address);

    googleCloudLog(LogSeverity.INFO, `${address} isLiquidatable=${isLiquidatable}`);

    if (isLiquidatable) {
      await attemptLiquidation(
        liquidator,
        [address],
        signerWithFlashbots
      );
      liquidationAttempted = true;
    }
  }
  return liquidationAttempted;
}

export async function arbitragePurchaseableCollateral(
  comet: CometInterface,
  liquidator: Liquidator,
  assets: Asset[],
  signerWithFlashbots: SignerWithFlashbots
) {
  googleCloudLog(LogSeverity.INFO, `Checking for purchaseable collateral`);

  if (await hasPurchaseableCollateral(comet, assets)) {
    googleCloudLog(LogSeverity.INFO, `There is purchaseable collateral`);
    await attemptLiquidation(
      liquidator,
      [], // empty list means we will only buy collateral and not absorb
      signerWithFlashbots
    );
  }
}

export async function getAssets(comet: CometInterface): Promise<Asset[]> {
  let numAssets = await comet.numAssets();
  let assets = [
    ...await Promise.all(Array(numAssets).fill(0).map(async (_, i) => {
      const asset = await comet.getAssetInfo(i);
      return { address: asset.asset, priceFeed: asset.priceFeed, scale: asset.scale.toBigInt() };
    })),
  ];
  return assets;
}