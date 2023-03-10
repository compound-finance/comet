import hre from 'hardhat';
import {
  CometInterface,
  OnChainLiquidator
} from '../../build/types';
import { PoolConfigStruct } from '../../build/types/OnChainLiquidator';
import { ethers, exp } from '../../test/helpers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import { BigNumberish, Signer } from 'ethers';
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

enum Exchange {
  Uniswap,
  SushiSwap,
  Balancer,
  Curve
}

const COMP = '0xc00e94cb662c3520282e6f5717214004a7f26888';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const LINK = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const WETH9 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const CB_ETH = '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704';
const WST_ETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const POLYGON_WBTC = '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6';
const POLYGON_WETH = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619';
const WMATIC = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';

const liquidationThresholds = {
  'mainnet': {
    'usdc': 10e6,
    'weth': 1e18
  },
  'goerli': {
    'usdc': 10e6
  },
  'polygon': {
    'usdc': 10e6
  }
};

export const flashLoanPools = {
  'mainnet': {
    'usdc': {
      tokenAddress: DAI,
      poolFee: 100
    },
    'weth': {
      tokenAddress: USDC,
      poolFee: 500
    }
  },
  'goerli': {
    'usdc': {
      // WETH pool
      tokenAddress: '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6',
      poolFee: 3000
    }
  },
  'polygon': {
    'usdc': {
      tokenAddress: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
      poolFee: 100
    }
  }
};

export function getPoolConfig(tokenAddress: string) {
  const defaultPoolConfig: PoolConfigStruct = {
    exchange: 0,
    uniswapPoolFee: 0,
    swapViaWeth: false,
    balancerPoolId: ethers.utils.formatBytes32String(''),
    curvePool: ethers.constants.AddressZero
  };

  const poolConfigs: {[tokenAddress: string]: PoolConfigStruct} = {
    [COMP.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.SushiSwap,
        swapViaWeth: true
      }
    },
    [WBTC.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Uniswap,
        swapViaWeth: true,
        uniswapPoolFee: 3000
      }
    },
    [WETH9.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Uniswap,
        swapViaWeth: false,
        uniswapPoolFee: 500
      }
    },
    [LINK.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Uniswap,
        swapViaWeth: true,
        uniswapPoolFee: 3000
      },
    },
    [UNI.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Uniswap,
        swapViaWeth: true,
        uniswapPoolFee: 3000
      }
    },
    [CB_ETH.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Uniswap,
        swapViaWeth: false,
        uniswapPoolFee: 500
      }
    },
    [WST_ETH.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Balancer,
        balancerPoolId: '0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080'
      }
    },
    [WMATIC.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Uniswap,
        swapViaWeth: false,
        uniswapPoolFee: 500
      }
    },
    [POLYGON_WBTC.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Uniswap,
        swapViaWeth: true,
        uniswapPoolFee: 500
      }
    },
    [POLYGON_WETH.toLowerCase()]: {
      ...defaultPoolConfig,
      ...{
        exchange: Exchange.Uniswap,
        swapViaWeth: false,
        uniswapPoolFee: 500
      }
    },
  };

  const poolConfig = poolConfigs[tokenAddress.toLowerCase()];

  if (!poolConfig) {
    throw new Error(`getPoolConfig > no pool config found for ${tokenAddress}`);
  }

  return poolConfig;
}

function getMaxAmountToPurchase(tokenAddress: string): bigint {
  const maxAmountsToPurchase: {[tokenAddress: string]: bigint} = {
    [COMP.toLowerCase()]: exp(500, 18),
    [LINK.toLowerCase()]: exp(200_000, 18),
    [UNI.toLowerCase()]: exp(100_000, 18),
    [WBTC.toLowerCase()]: exp(120, 8),
    [WETH9.toLowerCase()]: exp(5000, 18)
  };

  const max = maxAmountsToPurchase[tokenAddress.toLowerCase()];

  if (max === undefined) {
    throw new Error(`getMaxAmountToPurchase > no amount found for ${tokenAddress}`);
  }

  return max;
}

async function attemptLiquidation(
  comet: CometInterface,
  liquidator: OnChainLiquidator,
  targetAddresses: string[],
  signerWithFlashbots: SignerWithFlashbots,
  network: string,
  deployment: string
) {
  // 1) attempt liquidation for max amount of all assets
  const assets = await getAssets(comet);
  const assetAddresses = assets.map(a => a.address);
  const poolConfigs = assetAddresses.map(getPoolConfig);
  const maxAmountsToPurchase = assetAddresses.map(_ => ethers.constants.MaxUint256.toBigInt());

  const flashLoanPool = flashLoanPools[network][deployment];
  const liquidationThreshold = liquidationThresholds[network][deployment];

  const success = await attemptLiquidationViaOnChainLiquidator(
    comet,
    liquidator,
    targetAddresses,
    assetAddresses,
    poolConfigs,
    maxAmountsToPurchase,
    flashLoanPool.tokenAddress,
    flashLoanPool.poolFee,
    liquidationThreshold,
    signerWithFlashbots
  );

  // 2) if initial attempt fails...
  if (!success) {
    // absorb addresses...
    if (targetAddresses.length > 0) {
      const signerAddress = await signerWithFlashbots.signer.getAddress();
      await comet.absorb(signerAddress, targetAddresses);
    }

    // 3) buy smaller and smaller quantities of assets individually
    for (const asset of assets) {
      const maxAmountToPurchase = getMaxAmountToPurchase(asset.address);

      for (const amount of [maxAmountToPurchase, maxAmountToPurchase / 2n, maxAmountToPurchase / 10n]) {
        const success_ = await attemptLiquidationViaOnChainLiquidator(
          comet,
          liquidator,
          [],                             // target addresses
          [asset.address],                // assets
          [getPoolConfig(asset.address)], // pool configs
          [amount],                       // max amounts to purchase
          flashLoanPool.tokenAddress,
          flashLoanPool.poolFee,
          liquidationThreshold,
          signerWithFlashbots,
        );

        if (success_) { break; } // stop once you've cleared any amount of an asset
      }
    }
  }
}

async function attemptLiquidationViaOnChainLiquidator(
  comet: CometInterface,
  liquidator: OnChainLiquidator,
  targetAddresses: string[],
  assets: string[],
  poolConfigs: PoolConfigStruct[],
  maxAmountsToPurchase: BigNumberish[],
  flashLoanPoolTokenAddress: string,
  flashLoanPoolFee: number,
  liquidationThreshold: number,
  signerWithFlashbots: SignerWithFlashbots,
): Promise<boolean> {
  const liquidatorAddress = liquidator.address;

  googleCloudLog(LogSeverity.INFO, `Attempting to liquidate ${targetAddresses} via OnChainLiquidator @${liquidatorAddress}`);

  try {
    const args: [
      string,
      string[],
      string[],
      PoolConfigStruct[],
      BigNumberish[],
      string,
      number,
      number
    ] = [
      comet.address,
      targetAddresses,
      assets,
      poolConfigs,
      maxAmountsToPurchase,
      flashLoanPoolTokenAddress,
      flashLoanPoolFee,
      liquidationThreshold
    ];

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
      googleCloudLog(LogSeverity.INFO, `Successfully liquidated ${targetAddresses} via ${liquidatorAddress}`);
    } else {
      googleCloudLog(LogSeverity.ALERT, `Failed to liquidate ${targetAddresses} via ${liquidatorAddress}`);
    }
    return success;
  } catch (e) {
    googleCloudLog(
      LogSeverity.ALERT,
      `Failed to liquidate ${targetAddresses} via ${liquidatorAddress}: ${e.message}`
    );
    return false;
  }
}

async function getUniqueAddresses(comet: CometInterface): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  return new Set(withdrawEvents.map(event => event.args.src));
}

export async function hasPurchaseableCollateral(comet: CometInterface, assets: Asset[], minBaseValue: number): Promise<boolean> {
  const baseReserves = (await comet.getReserves()).toBigInt();
  const targetReserves = (await comet.targetReserves()).toBigInt();
  const baseScale = (await comet.baseScale()).toBigInt();

  if (baseReserves >= targetReserves) {
    return false;
  }

  for (const asset of assets) {
    const collateralReserves = await comet.getCollateralReserves(asset.address);
    const price = await comet.getPrice(asset.priceFeed);
    const priceScale = exp(1, 8);
    const value = collateralReserves.toBigInt() * price.toBigInt() * baseScale / asset.scale / priceScale;
    if (value >= minBaseValue) {
      return true;
    }
  }
  return false;
}

export async function liquidateUnderwaterBorrowers(
  comet: CometInterface,
  liquidator: OnChainLiquidator,
  signerWithFlashbots: SignerWithFlashbots,
  network: string,
  deployment: string
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
        network,
        deployment
      );
      liquidationAttempted = true;
    }
  }
  return liquidationAttempted;
}

export async function arbitragePurchaseableCollateral(
  comet: CometInterface,
  liquidator: OnChainLiquidator,
  assets: Asset[],
  signerWithFlashbots: SignerWithFlashbots,
  network: string,
  deployment: string
) {
  googleCloudLog(LogSeverity.INFO, `Checking for purchasable collateral`);

  const liquidationThreshold = liquidationThresholds[network][deployment];

  if (await hasPurchaseableCollateral(comet, assets, liquidationThreshold)) {
    googleCloudLog(LogSeverity.WARNING, `There is purchasable collateral`);
    await attemptLiquidation(
      comet,
      liquidator,
      [], // empty list means we will only buy collateral and not absorb
      signerWithFlashbots,
      network,
      deployment
    );
  } else {
    googleCloudLog(LogSeverity.INFO, `No purchasable collateral found`);
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