// Registry-driven Comet variant deploy.  Reads target params from the
// registry, deploys (or upgrades) a single Comet variant, returns the
// addresses for the caller to merge into the registry payload.
//
// Stays chain-agnostic — same code runs on any Rome chain (devnet /
// testnet / mainnet).  The chainId arg drives every parameter.

import { ethers } from "hardhat";
import type { Signer, ContractTransaction } from "ethers";
import type {
  CompoundDeployment,
  DeployOutcome,
  RegistryClient,
} from "./registry-client";

const SAFE_GAS_LIMIT_DEPLOY = 250_000_000;
const SAFE_GAS_LIMIT_INIT   = 5_000_000;
const SAFE_GAS_LIMIT_TX     = 30_000_000;

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  [retry ${i + 1}/${attempts}] ${label}: ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

export interface DeployVariantArgs {
  registry: RegistryClient;
  chainId: number;
  variantLabel: string;
  /** Which collateral asset symbols to wire into this Comet's assetConfigs[].  Empty = supply-only. */
  collateralSymbols: string[];
  signer: Signer;
  /** Cosmetic identifiers for CometExt (max 32 bytes each). */
  display: { name: string; symbol: string };
}

export interface DeployVariantOutcome {
  label: string;
  address: string;
  extensionDelegate: string;
  implementation: string;
  proxyAdmin: string;
  collateralAssets: string[];
}

/**
 * Deploy a fresh Comet variant (impl + ext + proxyAdmin + proxy + init).
 * Returns the 5 addresses, ready to plug into a DeployOutcome.
 *
 * If a Bulker hasn't been deployed yet on this chain, the caller deploys
 * it separately and passes the address into the registry payload.
 */
export async function deployCometVariant(args: DeployVariantArgs): Promise<DeployVariantOutcome> {
  const dep = args.registry.getCompoundDeployment(args.chainId);
  if (!dep) {
    throw new Error(`No registry entry for chainId=${args.chainId}; cannot resolve deploy params.`);
  }
  const baseAsset = dep.baseAsset.address;
  const baseFeed  = dep.baseTokenPriceFeed;

  const collats = args.collateralSymbols.map((sym) => {
    const found = dep.collateralAssets.find((c) => c.symbol === sym);
    if (!found) {
      throw new Error(`Collateral asset '${sym}' not declared in registry. Add it to apps/compound/${args.chainId}-${dep.chainSlug}.json:collateralAssets[].`);
    }
    return found;
  });

  console.log(`\n[deploy ${args.variantLabel}] base=${baseAsset} collats=[${args.collateralSymbols.join(',')}]`);

  // 1. CometProxyAdmin
  const CometProxyAdmin = await ethers.getContractFactory(
    "contracts/CometProxyAdmin.sol:CometProxyAdmin",
    args.signer,
  );
  const signerAddr = await args.signer.getAddress();
  const cpa = await withRetry("CometProxyAdmin", () =>
    CometProxyAdmin.deploy(signerAddr, { gasLimit: SAFE_GAS_LIMIT_TX }),
  );
  await cpa.deployed();
  console.log(`  cpa: ${cpa.address}`);

  // 2. CometExt
  const CometExt = await ethers.getContractFactory("contracts/CometExt.sol:CometExt", args.signer);
  const ext = await withRetry("CometExt", () =>
    CometExt.deploy(
      {
        name32:   ethers.utils.formatBytes32String(args.display.name),
        symbol32: ethers.utils.formatBytes32String(args.display.symbol),
      },
      { gasLimit: SAFE_GAS_LIMIT_TX },
    ),
  );
  await ext.deployed();
  console.log(`  ext: ${ext.address}`);

  // 3. Comet impl
  const cometConfig = {
    governor: signerAddr,
    pauseGuardian: signerAddr,
    baseToken: baseAsset,
    baseTokenPriceFeed: baseFeed,
    extensionDelegate: ext.address,
    supplyKink:                        ethers.BigNumber.from("850000000000000000"),
    supplyPerYearInterestRateSlopeLow:  ethers.BigNumber.from("48000000000000000"),
    supplyPerYearInterestRateSlopeHigh: ethers.BigNumber.from("1600000000000000000"),
    supplyPerYearInterestRateBase: 0,
    borrowKink:                        ethers.BigNumber.from("850000000000000000"),
    borrowPerYearInterestRateSlopeLow:  ethers.BigNumber.from("53000000000000000"),
    borrowPerYearInterestRateSlopeHigh: ethers.BigNumber.from("1700000000000000000"),
    borrowPerYearInterestRateBase:     ethers.BigNumber.from("15000000000000000"),
    storeFrontPriceFactor:             ethers.BigNumber.from("500000000000000000"),
    trackingIndexScale:                ethers.BigNumber.from("1000000000000000"),
    baseTrackingSupplySpeed: 0,
    baseTrackingBorrowSpeed: 0,
    baseMinForRewards:                 ethers.BigNumber.from("100").mul(1_000_000),
    baseBorrowMin: 1,
    targetReserves:                    ethers.BigNumber.from("5000000").mul(1_000_000),
    assetConfigs: collats.map((c) => ({
      asset: c.address,
      priceFeed: c.priceFeed,
      decimals: c.decimals,
      borrowCollateralFactor:    ethers.BigNumber.from("700000000000000000"),
      liquidateCollateralFactor: ethers.BigNumber.from("800000000000000000"),
      liquidationFactor:         ethers.BigNumber.from("900000000000000000"),
      supplyCap:                 ethers.utils.parseUnits("1000000", c.decimals),
    })),
  };
  const Comet = await ethers.getContractFactory("contracts/Comet.sol:Comet", args.signer);
  const cometImpl = await withRetry("Comet impl", () =>
    Comet.deploy(cometConfig, { gasLimit: SAFE_GAS_LIMIT_DEPLOY }),
  );
  await cometImpl.deployed();
  console.log(`  impl: ${cometImpl.address}`);

  // 4. Proxy
  const TUP = await ethers.getContractFactory(
    "contracts/vendor/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy",
    args.signer,
  );
  const proxy = await withRetry("TUP", () =>
    TUP.deploy(cometImpl.address, cpa.address, "0x", { gasLimit: SAFE_GAS_LIMIT_DEPLOY }),
  );
  await proxy.deployed();
  console.log(`  proxy: ${proxy.address}`);

  // 5. initializeStorage via proxy
  const cometViaProxy = new ethers.Contract(
    proxy.address,
    ["function initializeStorage()"],
    args.signer,
  );
  const initTx = await withRetry<ContractTransaction>("initializeStorage", () =>
    cometViaProxy.initializeStorage({ gasLimit: SAFE_GAS_LIMIT_INIT }),
  );
  await initTx.wait();
  console.log(`  init: ${initTx.hash}`);

  return {
    label: args.variantLabel,
    address: proxy.address,
    extensionDelegate: ext.address,
    implementation: cometImpl.address,
    proxyAdmin: cpa.address,
    collateralAssets: collats.map((c) => c.address),
  };
}

export interface DeployBulkerArgs {
  signer: Signer;
  /** Base asset address (registry's baseAsset.address). Used as the bulker's `weth` arg. */
  baseAsset: string;
}

/** Deploy a fresh BaseBulker. */
export async function deployBulker(args: DeployBulkerArgs): Promise<string> {
  console.log("\n[deploy BaseBulker]");
  const BaseBulker = await ethers.getContractFactory(
    "contracts/bulkers/BaseBulker.sol:BaseBulker",
    args.signer,
  );
  const signerAddr = await args.signer.getAddress();
  const bulker = await withRetry("BaseBulker", () =>
    BaseBulker.deploy(signerAddr, args.baseAsset, { gasLimit: SAFE_GAS_LIMIT_DEPLOY }),
  );
  await bulker.deployed();
  console.log(`  bulker: ${bulker.address}`);
  return bulker.address;
}

/** Compose the deploy outcome for buildRegistryUpdate(). */
export function makeDeployOutcome(
  chainId: number,
  bulker: string,
  variants: DeployVariantOutcome[],
  sourceCommits: Record<string, string>,
): DeployOutcome {
  return {
    chainId,
    bulker,
    comets: variants,
    sourceCommits,
    deployedAt: new Date().toISOString(),
  };
}

export type { CompoundDeployment, DeployOutcome };
