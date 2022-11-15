import hre from 'hardhat';
import {
  CometInterface,
  Liquidator
} from '../../build/types';
import { exp } from '../../test/helpers';
import { FlashbotsBundleProvider, FlashbotsBundleResolution, FlashbotsTransactionResponse, RelayResponseError } from '@flashbots/ethers-provider-bundle';
import { PopulatedTransaction, Signer } from 'ethers';
import googleCloudLog, { LogSeverity } from './googleCloudLog';

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
}

function isFlashbotsTxnResponse(bundleReceipt: FlashbotsTransactionResponse | RelayResponseError): bundleReceipt is FlashbotsTransactionResponse {
  return (bundleReceipt as FlashbotsTransactionResponse).bundleTransactions !== undefined;
}

async function sendFlashbotsBundle(
  txn: PopulatedTransaction,
  signerWithFlashbots: SignerWithFlashbots
): Promise<boolean> {
  const wallet = signerWithFlashbots.signer;
  const flashbotsProvider = signerWithFlashbots.flashbotsProvider;
  const signedBundle = await flashbotsProvider.signBundle(
    [
      {
        signer: wallet, // ethers signer
        transaction: txn // ethers populated transaction object
      }
    ])
  const bundleReceipt = await flashbotsProvider.sendRawBundle(
    signedBundle, // bundle we signed above
    await hre.ethers.provider.getBlockNumber() + 1, // block number at which this bundle is valid
  );
  let success: boolean;
  if (isFlashbotsTxnResponse(bundleReceipt)) {
    const resolution = await bundleReceipt.wait();
    if (resolution === FlashbotsBundleResolution.BundleIncluded) {
      success = true;
      googleCloudLog(LogSeverity.INFO, 'Bundle included!');
    } else if (resolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
      // XXX alert if too many attempts are not included in a block
      success = false;
      googleCloudLog(LogSeverity.INFO, 'Block passed without inclusion');
    } else if (resolution === FlashbotsBundleResolution.AccountNonceTooHigh) {
      success = false;
      googleCloudLog(LogSeverity.INFO, 'Account nonce too high');
    }
  } else {
    success = false;
    googleCloudLog(LogSeverity.ALERT, `Error while sending Flashbots bundle: ${bundleReceipt.error}`);
  }

  return success;
}

// XXX Note: Blocking txn, so we probably want to run these methods in separate threads
async function sendTxn(
  txn: PopulatedTransaction,
  signerWithFlashbots: SignerWithFlashbots
): Promise<boolean> {
  if (signerWithFlashbots.flashbotsProvider) {
    googleCloudLog(LogSeverity.INFO, 'Sending a private txn');
    return await sendFlashbotsBundle(txn, signerWithFlashbots);
  } else {
    googleCloudLog(LogSeverity.INFO, 'Sending a public txn');
    // XXX confirm that txn.wait() throws if the txn reverts
    await (await signerWithFlashbots.signer.sendTransaction(txn)).wait();
    return true;
  }
}

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