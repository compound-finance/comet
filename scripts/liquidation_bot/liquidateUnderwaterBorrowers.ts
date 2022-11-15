import hre from 'hardhat';
import {
  CometInterface,
  Liquidator
} from '../../build/types';
import { exp } from '../../test/helpers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import { Signer } from 'ethers';
import googleCloudLog, { LogSeverity } from './googleCloudLog';
import {sendTxn} from './sendTransaction';

export interface SignerWithFlashbots {
  signer: Signer;
  flashbotsProvider?: FlashbotsBundleProvider;
}

export interface Asset {
  address: string;
  priceFeed: string;
  scale: bigint;
}

const flashLoanPools = {
  'mainnet': {
    // DAI pool
    tokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    poolFee: 100
  },
  'goerli': {
    // WETH pool
    tokenAddress: '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6',
    poolFee: 3000
  }
};

async function attemptLiquidation(
  liquidator: Liquidator,
  targetAddresses: string[],
  signerWithFlashbots: SignerWithFlashbots,
  network: string
) {
  try {
    googleCloudLog(LogSeverity.INFO, `Attempting to liquidate ${targetAddresses} via ${liquidator.address}`);
    const flashLoanPool = flashLoanPools[network];
    const calldata = {
      accounts: targetAddresses,
      pairToken: flashLoanPool.tokenAddress,
      poolFee: flashLoanPool.poolFee
    };
    // XXX set appropriate gas price...currently we are overestimating slightly to be safe
    // XXX also factor in gas price to profitability
    const txn = await liquidator.populateTransaction.initFlash(calldata, {
      gasLimit: Math.ceil(1.1 * (await liquidator.estimateGas.initFlash(calldata)).toNumber()),
      gasPrice: Math.ceil(1.1 * (await hre.ethers.provider.getGasPrice()).toNumber()),
    });
    const success = await sendTxn(txn, signerWithFlashbots);
    if (success) {
      googleCloudLog(LogSeverity.INFO, `Successfully liquidated ${targetAddresses} via ${liquidator.address}`);
    } else {
      googleCloudLog(LogSeverity.ALERT, `Failed to liquidate ${targetAddresses} via ${liquidator.address}`);
    }
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
  signerWithFlashbots: SignerWithFlashbots,
  network: string
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
        signerWithFlashbots,
        network
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
  signerWithFlashbots: SignerWithFlashbots,
  network: string
) {
  googleCloudLog(LogSeverity.INFO, `Checking for purchaseable collateral`);

  if (await hasPurchaseableCollateral(comet, assets)) {
    googleCloudLog(LogSeverity.INFO, `There is purchaseable collateral`);
    await attemptLiquidation(
      liquidator,
      [], // empty list means we will only buy collateral and not absorb
      signerWithFlashbots,
      network
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