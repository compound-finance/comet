import hre from 'hardhat';
import axios from 'axios';
import {
  CometInterface,
  Liquidator,
  LiquidatorV2,
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

const protocols = [
  "UNISWAP_V1",
  "UNISWAP_V2",
  "SUSHI",
  "MOONISWAP",
  "BALANCER",
  "COMPOUND",
  "CURVE",
  "CURVE_V2_SPELL_2_ASSET",
  "CURVE_V2_SGT_2_ASSET",
  "CURVE_V2_THRESHOLDNETWORK_2_ASSET",
  "CHAI",
  "OASIS",
  "KYBER",
  "AAVE",
  "IEARN",
  "BANCOR",
  "PMM1",
  "SWERVE",
  "BLACKHOLESWAP",
  "DODO",
  "DODO_V2",
  "VALUELIQUID",
  "SHELL",
  "DEFISWAP",
  "SAKESWAP",
  "LUASWAP",
  "MINISWAP",
  "MSTABLE",
  "PMM2",
  "SYNTHETIX",
  "AAVE_V2",
  "ST_ETH",
  "ONE_INCH_LP",
  "ONE_INCH_LP_1_1",
  "LINKSWAP",
  "S_FINANCE",
  "PSM",
  "POWERINDEX",
  "PMM3",
  "XSIGMA",
  "SMOOTHY_FINANCE",
  "SADDLE",
  "PMM4",
  "KYBER_DMM",
  "BALANCER_V2",
  "UNISWAP_V3",
  "SETH_WRAPPER",
  "CURVE_V2",
  "CURVE_V2_EURS_2_ASSET",
  "CURVE_V2_EURT_2_ASSET",
  "CURVE_V2_XAUT_2_ASSET",
  "CURVE_V2_ETH_CRV",
  "CURVE_V2_ETH_CVX",
  "CONVERGENCE_X",
  "ONE_INCH_LIMIT_ORDER",
  "ONE_INCH_LIMIT_ORDER_V2",
  "ONE_INCH_LIMIT_ORDER_V3",
  "DFX_FINANCE",
  "FIXED_FEE_SWAP",
  "DXSWAP",
  "SHIBASWAP",
  "UNIFI",
  "PSM_PAX",
  "WSTETH",
  "DEFI_PLAZA",
  "FIXED_FEE_SWAP_V3",
  "SYNTHETIX_WRAPPER",
  "SYNAPSE",
  "CURVE_V2_YFI_2_ASSET",
  "CURVE_V2_ETH_PAL",
  "POOLTOGETHER",
  "ETH_BANCOR_V3",
  "ELASTICSWAP",
  "BALANCER_V2_WRAPPER",
  "FRAXSWAP",
  "RADIOSHACK",
  "KYBERSWAP_ELASTIC",
  "CURVE_V2_TWO_CRYPTO",
  "STABLE_PLAZA",
  "ZEROX_LIMIT_ORDER",
  "CURVE_3CRV",
  "KYBER_DMM_STATIC",
  "ANGLE",
  "ROCKET_POOL",
  "ETHEREUM_ELK",
  "ETHEREUM_PANCAKESWAP_V2",
  // "SYNTHETIX_ATOMIC_SIP288",
  "PSM_GUSD",
];

// XXX pull from network param
const chainId = 1;
// XXX delete
const walletAddress = '0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F';

const apiBaseUrl = 'https://api.1inch.io/v5.0/' + chainId;

function apiRequestUrl(methodName, queryParams) {
  return apiBaseUrl + methodName + '?' + (new URLSearchParams(queryParams)).toString();
}

export async function attemptLiquidation(
  comet: CometInterface,
  liquidator: LiquidatorV2,
  targetAddresses: string[],
  signerWithFlashbots: SignerWithFlashbots,
  network: string,
  excludeSources: string[] = []
) {
  // get the amount of collateral available for sale (using static call)
  const [
    addresses,
    collateralReserves,
    collateralReservesInBase
  ] = await liquidator.callStatic.availableCollateral(targetAddresses);

  console.log(`liquidator.address:`);
  console.log(liquidator.address);

  console.log({
    addresses,
    collateralReserves,
    collateralReservesInBase
  });

  let protocols = [];

  if (excludeSources.length > 0) {
    // const sources = 'https://api.1inch.io/v5.0/1/liquidity-sources'
    const sourceUrl = apiRequestUrl('/liquidity-sources', {});
    const res = await axios.get(sourceUrl);

    console.log(`sourceUrl:`);
    console.log(sourceUrl);


  }

  const baseToken = await comet.baseToken();

  let assets = [];
  let assetBaseAmounts = [];
  let swapTargets = [];
  let swapCallDatas = [];

  // for each amount, if it is high enough, get a quote
  for (const i in addresses) {
    const address = addresses[i];
    const collateralReserveAmount = collateralReserves[i];
    const collateralReserveAmountInBase = collateralReservesInBase[i];

    // check if collateralReserveAmountInBase is greater than threshold
    const liquidationThreshold = 1e6; // XXX increase, denominate in base scale

    if (collateralReserveAmountInBase > liquidationThreshold) {
      const swapParams = {
        fromTokenAddress: address,
        toTokenAddress: baseToken,
        amount: collateralReserveAmount.sub(1), // allow some fudge factor
        // amount: collateralReserveAmount,
        fromAddress: "0xCe71065D4017F316EC606Fe4422e11eB2c47c246",
        // fromAddress: liquidator.address,
        slippage: 2,
        disableEstimate: true,
        allowPartialFill: false,
        // protocols
      };
      const url = apiRequestUrl('/swap', swapParams);
      const { data } = await axios.get(url);

      console.log(`data:`);
      console.log(data);

      console.log(`data.protocols:`);
      console.log(JSON.stringify(data.protocols));

      assets.push(address);
      assetBaseAmounts.push(collateralReserveAmountInBase);
      swapTargets.push(data.tx.to);
      swapCallDatas.push(data.tx.data);

      // console.log("sending raw transaction data");
      // await (await signerWithFlashbots.signer.sendTransaction({
      //   // ...data.tx,
      //   from: data.tx.from,
      //   to: data.tx.to,
      //   data: data.tx.data,
      //   gasLimit: 1e6
      // })).wait();
      // console.log("done sending raw transaction data");

    }
  }

  console.log(`assets:`);
  console.log(assets);

  console.log(`assetBaseAmounts:`);
  console.log(assetBaseAmounts);

  console.log(`swapTargets:`);
  console.log(swapTargets);

  console.log(`swapCallDatas:`);
  console.log(swapCallDatas);

  console.log("absorbAndArbitrage()");

  const tx = await liquidator.absorbAndArbitrage(
    targetAddresses,
    assets,
    // assetBaseAmounts,
    swapTargets,
    swapCallDatas
  );
  console.log("absorbAndArbitrage() done");

  // console.log(`tx:`);
  // console.log(tx);
  // const trace = await world.deploymentManager.hre.network.provider.send("debug_traceTransaction", [
  //   tx.hash
  // ]);
  // console.log(`trace:`);
  // console.log(trace);


  // try {
  //   googleCloudLog(LogSeverity.INFO, `Attempting to liquidate ${targetAddresses} via ${liquidator.address}`);
  //   const flashLoanPool = flashLoanPools[network];
  //   const calldata = {
  //     accounts: targetAddresses,
  //     pairToken: flashLoanPool.tokenAddress,
  //     poolFee: flashLoanPool.poolFee
  //   };
  //   // XXX set appropriate gas price...currently we are overestimating slightly to be safe
  //   // XXX also factor in gas price to profitability
  //   const txn = await liquidator.connect(signerWithFlashbots.signer).populateTransaction.initFlash(calldata, {
  //     gasLimit: Math.ceil(1.1 * (await liquidator.estimateGas.initFlash(calldata)).toNumber()),
  //     gasPrice: Math.ceil(1.1 * (await hre.ethers.provider.getGasPrice()).toNumber()),
  //   });
  //   const success = await sendTxn(txn, signerWithFlashbots);
  //   if (success) {
  //     googleCloudLog(LogSeverity.INFO, `Successfully liquidated ${targetAddresses} via ${liquidator.address}`);
  //   } else {
  //     googleCloudLog(LogSeverity.ALERT, `Failed to liquidate ${targetAddresses} via ${liquidator.address}`);
  //   }
  // } catch (e) {
  //   throw e;
  //   // googleCloudLog(
  //   //   LogSeverity.ALERT,
  //   //   `Failed to liquidate ${targetAddresses} via ${liquidator.address}: ${e.message}`
  //   // );
  // }
}

async function getUniqueAddresses(comet: CometInterface): Promise<Set<string>> {
  // XXX how far back does this go?
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