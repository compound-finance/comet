// MultiAssetWrapperFactory — deploys per-mint UnifiedToken instances.
//
// Tier B foundational artifact (spec §1b §11a). Compound's deployment uses
// the factory to deploy at least one collateral wrapper (jitoSOL); future
// protocols (Morpho with multiple isolated markets, RWA with per-issuer tokens)
// scale to many wrappers. Factory pattern avoids each protocol re-implementing
// the deployment dance.
//
// Behavior:
//   - deploy(mint, name, symbol, decimals) → address of new UnifiedToken
//   - deploy() emits UnifiedTokenDeployed(mint, wrapper, name, symbol)
//   - second deploy with the same mint reverts (one canonical wrapper per mint)
//   - factory.wrapperFor(mint) returns 0x0 if not deployed, else the address
//   - admin role can transfer; only admin can deploy

import {
  expect, ethers,
  installMockPrecompiles,
  USDC_MINT_DEVNET,
  USDS_MINT_PLACEHOLDER,
} from './_helpers';

describe('MultiAssetWrapperFactory', function () {
  let factory: any;
  let admin: any;
  let alice: any;

  beforeEach(async () => {
    [admin, alice] = await ethers.getSigners();
    await installMockPrecompiles();

    const F = await ethers.getContractFactory('MultiAssetWrapperFactory');
    factory = await F.deploy();
    await factory.deployed();
  });

  it('deploys a UnifiedToken and registers it', async () => {
    const tx = await factory.connect(admin).deploy(
      USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6,
    );
    const rcpt = await tx.wait();
    const ev = rcpt.events!.find((e: any) => e.event === 'UnifiedTokenDeployed');
    expect(ev).to.not.be.undefined;
    expect(ev.args.mint).to.equal(USDC_MINT_DEVNET);

    const addr = await factory.wrapperFor(USDC_MINT_DEVNET);
    expect(addr).to.equal(ev.args.wrapper);
    expect(addr).to.not.equal(ethers.constants.AddressZero);
  });

  it('reverts on second deploy with same mint', async () => {
    await factory.connect(admin).deploy(USDC_MINT_DEVNET, 'A', 'A', 6);
    await expect(
      factory.connect(admin).deploy(USDC_MINT_DEVNET, 'B', 'B', 6),
    ).to.be.revertedWith('MultiAssetWrapperFactory: already deployed');
  });

  it('multiple distinct mints can be deployed', async () => {
    await factory.connect(admin).deploy(USDC_MINT_DEVNET, 'USDC', 'USDC', 6);
    await factory.connect(admin).deploy(USDS_MINT_PLACEHOLDER, 'USDS', 'USDS', 6);

    const usdcAddr = await factory.wrapperFor(USDC_MINT_DEVNET);
    const usdsAddr = await factory.wrapperFor(USDS_MINT_PLACEHOLDER);
    expect(usdcAddr).to.not.equal(usdsAddr);
  });

  it('wrapperFor returns 0x0 for un-deployed mints', async () => {
    const addr = await factory.wrapperFor(USDS_MINT_PLACEHOLDER);
    expect(addr).to.equal(ethers.constants.AddressZero);
  });

  it('non-admin cannot deploy', async () => {
    await expect(
      factory.connect(alice).deploy(USDC_MINT_DEVNET, 'A', 'A', 6),
    ).to.be.revertedWith('MultiAssetWrapperFactory: not admin');
  });

  it('deployed wrapper has the factory admin as initial admin (forwarded)', async () => {
    await factory.connect(admin).deploy(USDC_MINT_DEVNET, 'A', 'A', 6);
    const addr = await factory.wrapperFor(USDC_MINT_DEVNET);
    const T = await ethers.getContractFactory('UnifiedToken');
    const token = T.attach(addr);
    // Factory passes msg.sender (admin) as the deployed wrapper's admin.
    expect(await token.admin()).to.equal(admin.address);
  });

  it('deployedMints() enumerates registered mints', async () => {
    await factory.connect(admin).deploy(USDC_MINT_DEVNET, 'USDC', 'USDC', 6);
    await factory.connect(admin).deploy(USDS_MINT_PLACEHOLDER, 'USDS', 'USDS', 6);

    const mints = await factory.deployedMints();
    expect(mints.length).to.equal(2);
    expect(mints).to.include(USDC_MINT_DEVNET);
    expect(mints).to.include(USDS_MINT_PLACEHOLDER);
  });
});
