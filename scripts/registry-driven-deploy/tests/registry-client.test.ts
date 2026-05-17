// Failing tests for the registry-driven deploy library.
//
// Run: npx hardhat test scripts/registry-driven-deploy/tests/registry-client.test.ts
//   (with mocha + chai which is what hardhat-chai-matchers ships)

import { expect } from "chai";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  RegistryClient,
  RegistryNotFoundError,
  RegistryEntryMissingError,
  buildRegistryUpdate,
  type CompoundDeployment,
  type DeployOutcome,
} from "../lib/registry-client";

function makeFakeRegistry(): string {
  const root = path.join(tmpdir(), `rome-registry-fake-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.join(root, "apps", "compound"), { recursive: true });
  return root;
}

function writeEntry(root: string, chainId: number, slug: string, entry: CompoundDeployment): void {
  const p = path.join(root, "apps", "compound", `${chainId}-${slug}.json`);
  writeFileSync(p, JSON.stringify(entry, null, 2));
}

function hadrianEntry(): CompoundDeployment {
  return {
    schemaVersion: "1",
    chainId: 200010,
    chainSlug: "hadrian",
    compoundVersion: "v3-0.16.0",
    baseAsset: {
      type: "wrapper",
      address: "0xc1418f71Fdd16F8010382da1F796C2C90c6508b0",
      underlyingMint: "3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7",
      displaySymbol: "wUSDC",
      sourceRef: "rome-solidity@b662123",
    },
    comets: [
      {
        label: "supply-only",
        address: "0xBD0707F03B51fE2eB94519D319fEe2DbA02DB135",
        extensionDelegate: "0x0448b1c8d4bD6259588B5B936AE09DA180aC03a0",
        implementation: "0xE45E740053f1E245303f36dEDd3fCA65D64bA8Cb",
        proxyAdmin: "0x36aB36d5E48fDd3440b1C2EbEa360F3b76d0B2EF",
        collateralAssets: [],
      },
      {
        label: "collat-pcol",
        address: "0x10731DF2488ed1f7aA4D39E04235358C99C7c9F0",
        extensionDelegate: "0xc922a24e997fed92E912280292cef1d865058Ae0",
        implementation: "0x7B8774d2A64F112a320bB00349E19255Ae3aC590",
        proxyAdmin: "0x36aB36d5E48fDd3440b1C2EbEa360F3b76d0B2EF",
        collateralAssets: ["0x113A5f117D6E5324921d0434ade49a0659B67795"],
      },
    ],
    bulker: "0xD896ECe11fBAE90255c8010e4c5c5BD6DBb4A874",
    collateralAssets: [
      {
        symbol: "PCOL",
        address: "0x113A5f117D6E5324921d0434ade49a0659B67795",
        priceFeed: "0x5C4B14eE8e9533f8e34B2fa0D533F4942d6b5633",
        priceFeedKind: "simple",
        decimals: 18,
      },
    ],
    baseTokenPriceFeed: "0x061434caB7F8e6F7E396231Ae9b277a5e14c6254",
    baseTokenPriceFeedKind: "simple",
    jito: {
      enabled: false,
      reason: "Hadrian on Solana devnet; no Jito Block Engine",
    },
    ux: {
      singleTxFlows: ["supply", "withdraw"],
      bundleFlows: [],
      fallbackFlows: ["sequentialNTx"],
    },
    demoUrl: "https://compound.testnet.romeprotocol.xyz",
    rpcRef: "chains/200010-hadrian/chain.json#rpcUrl",
    deployedAt: "2026-05-17T09:11:00Z",
    sourceCommits: {
      comet: "compound-on-rome-comet@1b22af2c",
      wrapper: "rome-solidity@b662123",
    },
    status: "draft",
  };
}

describe("RegistryClient", () => {
  it("throws RegistryNotFoundError when the registry root doesn't exist", () => {
    expect(() => new RegistryClient({ registryRoot: "/nonexistent/path" }))
      .to.throw(RegistryNotFoundError);
  });

  it("getCompoundDeployment returns undefined for unknown chains", () => {
    const root = makeFakeRegistry();
    try {
      const client = new RegistryClient({ registryRoot: root });
      expect(client.getCompoundDeployment(99999999)).to.be.undefined;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("getCompoundDeployment returns the entry for known chains", () => {
    const root = makeFakeRegistry();
    writeEntry(root, 200010, "hadrian", hadrianEntry());
    try {
      const client = new RegistryClient({ registryRoot: root });
      const dep = client.getCompoundDeployment(200010);
      expect(dep).to.not.be.undefined;
      expect(dep!.chainId).to.equal(200010);
      expect(dep!.bulker).to.equal("0xD896ECe11fBAE90255c8010e4c5c5BD6DBb4A874");
      expect(dep!.comets).to.have.length(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolveDeployTarget throws RegistryEntryMissingError when no entry exists", () => {
    const root = makeFakeRegistry();
    try {
      const client = new RegistryClient({ registryRoot: root });
      expect(() => client.resolveDeployTarget(200010))
        .to.throw(RegistryEntryMissingError, /apps\/compound entry for chainId=200010/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolveDeployTarget extracts deploy params from registry (no hardcoding)", () => {
    const root = makeFakeRegistry();
    writeEntry(root, 200010, "hadrian", hadrianEntry());
    try {
      const client = new RegistryClient({ registryRoot: root });
      const target = client.resolveDeployTarget(200010);
      expect(target.chainId).to.equal(200010);
      expect(target.chainSlug).to.equal("hadrian");
      expect(target.baseAssetAddress).to.equal("0xc1418f71Fdd16F8010382da1F796C2C90c6508b0");
      expect(target.baseTokenPriceFeed).to.equal("0x061434caB7F8e6F7E396231Ae9b277a5e14c6254");
      expect(target.collateralAssets).to.have.length(1);
      expect(target.collateralAssets[0].symbol).to.equal("PCOL");
      expect(target.cometVariants).to.have.length(2);
      expect(target.cometVariants.map((v) => v.label)).to.deep.equal(["supply-only", "collat-pcol"]);
      expect(target.currentBulker).to.equal("0xD896ECe11fBAE90255c8010e4c5c5BD6DBb4A874");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolveDeployTarget treats zero-address as 'first-time' (current: null)", () => {
    const root = makeFakeRegistry();
    const fresh = hadrianEntry();
    fresh.bulker = "0x0000000000000000000000000000000000000000";
    fresh.comets[0].address = "0x0000000000000000000000000000000000000000";
    writeEntry(root, 200010, "hadrian", fresh);
    try {
      const client = new RegistryClient({ registryRoot: root });
      const target = client.resolveDeployTarget(200010);
      expect(target.currentBulker).to.be.null;
      expect(target.cometVariants[0].current).to.be.null;
      // The 2nd variant still has a real address
      expect(target.cometVariants[1].current).to.equal("0x10731DF2488ed1f7aA4D39E04235358C99C7c9F0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("buildRegistryUpdate", () => {
  it("produces a new entry that merges deploy outcome over previous", () => {
    const previous = hadrianEntry();
    const outcome: DeployOutcome = {
      chainId: 200010,
      bulker: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      comets: [
        {
          label: "supply-only",
          address: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          extensionDelegate: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          implementation: "0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
          proxyAdmin: "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
          collateralAssets: [],
        },
      ],
      sourceCommits: { comet: "compound-on-rome-comet@deadbeef" },
      deployedAt: "2026-05-18T12:00:00Z",
    };
    const next = buildRegistryUpdate(previous, outcome);
    expect(next.bulker).to.equal("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(next.comets).to.have.length(1);
    expect(next.comets[0].address).to.equal("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    expect(next.sourceCommits.comet).to.equal("compound-on-rome-comet@deadbeef");
    expect(next.sourceCommits.wrapper).to.equal("rome-solidity@b662123"); // preserved
    expect(next.deployedAt).to.equal("2026-05-18T12:00:00Z");
    // status is preserved — operator flips draft→live in a separate PR
    expect(next.status).to.equal("draft");
  });

  it("throws when chainId mismatches between previous and outcome", () => {
    const previous = hadrianEntry();
    const outcome: DeployOutcome = {
      chainId: 999,
      bulker: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      comets: [],
      sourceCommits: {},
      deployedAt: "2026-05-18T12:00:00Z",
    };
    expect(() => buildRegistryUpdate(previous, outcome)).to.throw(/chainId mismatch/);
  });
});
