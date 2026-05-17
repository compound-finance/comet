// Thin registry client for the registry-driven deploy.  Reads
// apps/compound/<chainId>-<slug>.json from a local registry checkout (dev
// mode) or the published NPM package (CI/prod).  Keeps the deploy scripts
// chain-agnostic — adding Compound to a new Rome chain is a registry edit,
// not a code change here.
//
// Lifted from the public API surface added in registry PR #120; mirrored
// here for offline use until @rome-protocol/registry v0.11.0 ships on NPM.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export interface CompoundDeployment {
  schemaVersion: "1";
  chainId: number;
  chainSlug: string;
  compoundVersion: string;
  baseAsset: {
    type: "wrapper" | "native-erc20";
    address: string;
    underlyingMint?: string;
    displaySymbol: string;
    sourceRef: string;
  };
  comets: Array<{
    label: string;
    address: string;
    extensionDelegate: string;
    implementation: string;
    proxyAdmin: string;
    collateralAssets: string[];
  }>;
  bulker: string;
  collateralAssets: Array<{
    symbol: string;
    address: string;
    priceFeed: string;
    priceFeedKind: "pyth-pull" | "switchboard-v3" | "chainlink" | "simple";
    decimals: number;
  }>;
  baseTokenPriceFeed: string;
  baseTokenPriceFeedKind: "pyth-pull" | "switchboard-v3" | "chainlink" | "simple";
  jito: {
    enabled: boolean;
    reason?: string;
    endpoint?: string | null;
    tipAccount?: string;
  };
  ux: {
    singleTxFlows: string[];
    bundleFlows: string[];
    fallbackFlows: string[];
  };
  demoUrl: string;
  rpcRef: string;
  deployedAt: string;
  sourceCommits: Record<string, string>;
  status: "live" | "retired" | "draft";
  notes?: string;
}

export interface CometVariantTarget {
  label: string;
  /** Existing Comet address if upgrading; null on first-time deploy of this variant. */
  current: string | null;
  /** Collateral asset addresses configured (or to configure) on this Comet. */
  collateralAssets: string[];
}

export interface DeployTarget {
  chainId: number;
  chainSlug: string;
  baseAssetAddress: string;
  baseTokenPriceFeed: string;
  baseTokenPriceFeedKind: string;
  collateralAssets: CompoundDeployment["collateralAssets"];
  cometVariants: CometVariantTarget[];
  /** Existing bulker if any; null on first-time deploy. */
  currentBulker: string | null;
}

export class RegistryNotFoundError extends Error {}
export class RegistryEntryMissingError extends Error {}

export interface RegistryClientOpts {
  /** Path to the registry checkout root.  Required for dev mode. */
  registryRoot: string;
}

export class RegistryClient {
  constructor(private readonly opts: RegistryClientOpts) {
    if (!existsSync(opts.registryRoot)) {
      throw new RegistryNotFoundError(`registry root not found: ${opts.registryRoot}`);
    }
  }

  getCompoundDeployment(chainId: number): CompoundDeployment | undefined {
    const dir = path.join(this.opts.registryRoot, "apps", "compound");
    if (!existsSync(dir)) return undefined;
    const prefix = `${chainId}-`;
    const found = readdirSync(dir).find(
      (f) => f.startsWith(prefix) && f.endsWith(".json"),
    );
    if (!found) return undefined;
    const raw = readFileSync(path.join(dir, found), "utf8");
    return JSON.parse(raw) as CompoundDeployment;
  }

  /**
   * Resolves the deploy target for chainId — what addresses are already
   * deployed (for upgrade-in-place) vs need to be created (first-time
   * deploy of a new Comet variant or a fresh chain).
   */
  resolveDeployTarget(chainId: number): DeployTarget {
    const dep = this.getCompoundDeployment(chainId);
    if (!dep) {
      throw new RegistryEntryMissingError(
        `No apps/compound entry for chainId=${chainId}. ` +
        `Create apps/compound/${chainId}-<slug>.json in the registry first.`,
      );
    }
    return {
      chainId: dep.chainId,
      chainSlug: dep.chainSlug,
      baseAssetAddress: dep.baseAsset.address,
      baseTokenPriceFeed: dep.baseTokenPriceFeed,
      baseTokenPriceFeedKind: dep.baseTokenPriceFeedKind,
      collateralAssets: dep.collateralAssets,
      cometVariants: dep.comets.map((c) => ({
        label: c.label,
        current: c.address && c.address !== "0x0000000000000000000000000000000000000000"
          ? c.address
          : null,
        collateralAssets: c.collateralAssets,
      })),
      currentBulker: dep.bulker && dep.bulker !== "0x0000000000000000000000000000000000000000"
        ? dep.bulker
        : null,
    };
  }
}

/** Patch fields produced by a deploy run — addresses that need writing back. */
export interface DeployOutcome {
  chainId: number;
  bulker: string;
  comets: Array<{
    label: string;
    address: string;
    extensionDelegate: string;
    implementation: string;
    proxyAdmin: string;
    collateralAssets: string[];
  }>;
  sourceCommits: Record<string, string>;
  deployedAt: string;
}

/**
 * Build the next-version of the registry entry from a deploy outcome.
 * Returns the JSON payload to write back into apps/compound/<chainId>-<slug>.json.
 * Caller is expected to land this via a separate registry PR using
 * /publish-registry-pr — we don't auto-commit.
 */
export function buildRegistryUpdate(
  previous: CompoundDeployment,
  outcome: DeployOutcome,
): CompoundDeployment {
  if (previous.chainId !== outcome.chainId) {
    throw new Error(
      `chainId mismatch: previous=${previous.chainId}, outcome=${outcome.chainId}`,
    );
  }
  return {
    ...previous,
    comets: outcome.comets,
    bulker: outcome.bulker,
    sourceCommits: { ...previous.sourceCommits, ...outcome.sourceCommits },
    deployedAt: outcome.deployedAt,
    // status stays at whatever previous had — operator flips draft→live
    // in a separate PR after smoke-testing the new addresses.
  };
}
