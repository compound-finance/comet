// Registry-driven Compound stack deploy.  One entry point per chain.
//
// Reads the target chainId from CHAIN_ID env var, resolves the deploy
// target from apps/compound/<chainId>-<slug>.json in the registry, deploys
// fresh Comet variants + Bulker, and writes the resulting payload to
// scripts/registry-driven-deploy/state/<chainId>.json.
//
// The output payload is the next-version registry entry.  Caller is
// expected to land it via a separate registry PR (no auto-write).
//
// Usage:
//   CHAIN_ID=200010 REGISTRY_ROOT=/path/to/registry-checkout \
//     ETH_PK=<deployer-pk> \
//     npx hardhat run scripts/registry-driven-deploy/deploy.ts --network hadrian
//
// Variants deployed are inferred from the registry entry's `comets[].label`
// list: every label gets a fresh impl + proxy.  Add a new variant by editing
// the registry JSON; this script picks it up automatically.

import { ethers } from "hardhat";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  RegistryClient,
  buildRegistryUpdate,
} from "./lib/registry-client";
import {
  deployCometVariant,
  deployBulker,
  makeDeployOutcome,
} from "./lib/deploy-comet-variant";

async function main() {
  const chainIdArg = process.env.CHAIN_ID;
  if (!chainIdArg) throw new Error("CHAIN_ID env var required.");
  const chainId = Number(chainIdArg);

  const registryRoot = process.env.REGISTRY_ROOT
    ?? path.resolve(__dirname, "../../../../registry");
  const registry = new RegistryClient({ registryRoot });

  const dep = registry.getCompoundDeployment(chainId);
  if (!dep) {
    throw new Error(`No apps/compound entry for chainId=${chainId} at ${registryRoot}. Create it first.`);
  }
  console.log(`\n=== Registry-driven Compound deploy ===`);
  console.log(`Chain: ${chainId}-${dep.chainSlug}`);
  console.log(`Base asset: ${dep.baseAsset.address} (${dep.baseAsset.displaySymbol})`);
  console.log(`Comet variants to (re)deploy:`);
  dep.comets.forEach((c) => console.log(`  ${c.label} — collats=[${c.collateralAssets.length}]`));

  const [signer] = await ethers.getSigners();
  console.log(`Deployer: ${signer.address}`);
  const startBal = await signer.getBalance();
  console.log(`Balance: ${ethers.utils.formatEther(startBal)} gas`);

  // Deploy each variant declared in the registry.  Resolve collateral
  // symbols by cross-referencing top-level collateralAssets[].
  const variants = [];
  for (const cometRecord of dep.comets) {
    const collatSymbols = cometRecord.collateralAssets.map((addr) => {
      const c = dep.collateralAssets.find((x) => x.address.toLowerCase() === addr.toLowerCase());
      if (!c) throw new Error(`Collateral asset ${addr} on variant ${cometRecord.label} not declared in collateralAssets[].`);
      return c.symbol;
    });
    const v = await deployCometVariant({
      registry,
      chainId,
      variantLabel: cometRecord.label,
      collateralSymbols: collatSymbols,
      signer,
      display: {
        name: truncate32(`Comp ${dep.baseAsset.displaySymbol} ${cometRecord.label}`),
        symbol: truncate32(`c${dep.baseAsset.displaySymbol}-${cometRecord.label}`),
      },
    });
    variants.push(v);
  }

  // Deploy bulker (one per chain)
  const bulker = await deployBulker({ signer, baseAsset: dep.baseAsset.address });

  // Resolve git SHAs for sourceCommits
  const commits = resolveSourceCommits();

  const outcome = makeDeployOutcome(chainId, bulker, variants, commits);
  const nextEntry = buildRegistryUpdate(dep, outcome);

  // Write payload — operator lands via /publish-registry-pr
  const outDir = path.join(__dirname, "state");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${chainId}-${dep.chainSlug}.json`);
  writeFileSync(outFile, JSON.stringify(nextEntry, null, 2));

  const endBal = await signer.getBalance();
  console.log(`\n=== Deploy complete ===`);
  console.log(`Gas burned: ${ethers.utils.formatEther(startBal.sub(endBal))} gas`);
  console.log(`Bulker: ${bulker}`);
  for (const v of variants) console.log(`  ${v.label}: ${v.address}`);
  console.log(`\nNext-version registry payload: ${outFile}`);
  console.log(`Land via: cd registry && cp ${outFile} apps/compound/${chainId}-${dep.chainSlug}.json && /publish-registry-pr`);
}

function truncate32(s: string): string {
  return s.length > 31 ? s.slice(0, 31) : s;
}

function resolveSourceCommits(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    if (pkg.name) out.comet = `${pkg.name}@${pkg.version}`;
  } catch { /* ignore */ }
  // The hardhat run env knows the git SHA; pick it up from GITHUB_SHA or
  // git rev-parse if available.  Leave undefined fields off otherwise.
  if (process.env.GITHUB_SHA) {
    out.cometSha = process.env.GITHUB_SHA;
  }
  if (process.env.ROME_SOLIDITY_REF) out.wrapper = process.env.ROME_SOLIDITY_REF;
  if (process.env.ROME_EVM_PRIVATE_REF) out.romeEvm = process.env.ROME_EVM_PRIVATE_REF;
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
