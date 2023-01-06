import hre from 'hardhat';
import axios from 'axios';
import {
  CometInterface,
  LiquidatorV2,
} from '../../build/types';
import { exp } from '../../test/helpers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import { Signer } from 'ethers';
import googleCloudLog, { LogSeverity } from './googleCloudLog';
import { sendTxn } from './sendTransaction';

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

// XXX pull from network param
const chainId = 1;
const apiBaseUrl = `https://api.1inch.io/v5.0/${chainId}`;

function apiRequestUrl(methodName, queryParams) {
  return apiBaseUrl + methodName + '?' + (new URLSearchParams(queryParams)).toString();
}

export async function getSwapInfo(
  comet: CometInterface,
  liquidator: LiquidatorV2,
  targetAddresses: string[]
) {
  // get the amount of collateral available for sale (using static call)
  const [
    assets,
    collateralReserves,
    collateralReservesInBase
  ] = await liquidator.callStatic.availableCollateral(comet.address, targetAddresses);

  const baseToken = await comet.baseToken();

  let swapAssets = [];
  let swapTargets = [];
  let swapCallDatas = [];

  // for each amount, if it is high enough, get a quote
  for (const i in assets) {
    const asset = assets[i];
    const collateralReserveAmount = collateralReserves[i];
    const collateralReserveAmountInBase = collateralReservesInBase[i];

    // check if collateralReserveAmountInBase is greater than threshold
    const liquidationThreshold = 1e6; // XXX increase, denominate in base scale

    if (collateralReserveAmountInBase.toBigInt() > liquidationThreshold) {
      const swapParams = {
        fromTokenAddress: asset,
        toTokenAddress: baseToken,
        amount: collateralReserveAmount,
        fromAddress: liquidator.address,
        slippage: 2,
        disableEstimate: true,
        allowPartialFill: false,
      };
      const url = apiRequestUrl('/swap', swapParams);
      const { data } = await axios.get(url);

      swapAssets.push(asset);
      swapTargets.push(data.tx.to);
      swapCallDatas.push(data.tx.data);
    }
  }

  return {
    swapAssets,
    swapTargets,
    swapCallDatas
  };
}

export async function attemptLiquidation(
  comet: CometInterface,
  liquidator: LiquidatorV2,
  targetAddresses: string[],
  signerWithFlashbots: SignerWithFlashbots,
  network: string
) {
  try {
    googleCloudLog(LogSeverity.INFO, `Attempting to liquidate ${targetAddresses} via ${liquidator.address}`);

    const flashLoanPool = flashLoanPools[network];

    const { swapAssets, swapTargets, swapCallDatas } = await getSwapInfo(comet, liquidator, targetAddresses);

    const args: [
      string,
      string[],
      string[],
      string[],
      string[],
      string,
      number
    ] = [
      comet.address,
      targetAddresses,
      swapAssets,
      swapTargets,
      swapCallDatas,
      flashLoanPool.tokenAddress,
      flashLoanPool.poolFee
    ];

    // XXX set appropriate gas price...currently we are overestimating slightly to be safe
    // XXX also factor in gas price to profitability
    const txn = await liquidator.populateTransaction.absorbAndArbitrage(
      ...args,
      {
        gasLimit: Math.ceil(1.1 * (await liquidator.estimateGas.absorbAndArbitrage(...args)).toNumber()),
        gasPrice: Math.ceil(1.1 * (await hre.ethers.provider.getGasPrice()).toNumber()),
      }
    );

    // ensure that .populateTransaction has not added a "from" key
    delete txn.from;

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
  // XXX how far back does this go?
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  return new Set(withdrawEvents.map(event => event.args.src));
}

// XXX
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
  liquidator: LiquidatorV2,
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
        comet,
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
  liquidator: LiquidatorV2,
  assets: Asset[],
  signerWithFlashbots: SignerWithFlashbots,
  network: string
) {
  googleCloudLog(LogSeverity.INFO, `Checking for purchasable collateral`);

  if (await hasPurchaseableCollateral(comet, assets)) {
    googleCloudLog(LogSeverity.WARNING, `There is purchasable collateral`);
    await attemptLiquidation(
      comet,
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