// UnifiedToken — parameterized over Solana mint pubkey (foundational, Tier B).
//
// Per spec §1b + §11a: the SAME compiled artifact must serve different
// stablecoins / tokens, simply by deploying with a different `mint_id`
// constructor argument. Compound today instantiates `UnifiedToken(USDC_mint)`;
// Sky's USDS deployment instantiates `UnifiedToken(USDS_mint)`; JupUSD is
// `UnifiedToken(JupUSD_mint)`. No per-token forks.
//
// These tests ensure the contract isolates state properly between two
// deployments — balances, allowances, snapshots cross neither way.

import {
  expect, ethers,
  installMockPrecompiles,
  encodeSplTokenAccountData,
  USDC_MINT_DEVNET,
  USDS_MINT_PLACEHOLDER,
  JUPUSD_MINT_PLACEHOLDER,
} from './_helpers';

describe('UnifiedToken — parameterized mint isolation', function () {
  let usdcToken: any;
  let usdsToken: any;
  let jupUsdToken: any;
  let sys: any;
  let cpi: any;
  let admin: any;
  let alice: any;
  let bob: any;

  beforeEach(async () => {
    [admin, alice, bob] = await ethers.getSigners();
    ({ sys, cpi } = await installMockPrecompiles());

    const T = await ethers.getContractFactory('UnifiedToken');
    usdcToken = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    usdsToken = await T.deploy(USDS_MINT_PLACEHOLDER, 'Unified USDS', 'USDS', 6, admin.address);
    jupUsdToken = await T.deploy(JUPUSD_MINT_PLACEHOLDER, 'Unified JupUSD', 'JupUSD', 6, admin.address);
  });

  it('three instances are distinct contract addresses', async () => {
    expect(usdcToken.address).to.not.equal(usdsToken.address);
    expect(usdsToken.address).to.not.equal(jupUsdToken.address);
    expect(usdcToken.address).to.not.equal(jupUsdToken.address);
  });

  it('each instance reads only its own mint', async () => {
    expect(await usdcToken.mintId()).to.equal(USDC_MINT_DEVNET);
    expect(await usdsToken.mintId()).to.equal(USDS_MINT_PLACEHOLDER);
    expect(await jupUsdToken.mintId()).to.equal(JUPUSD_MINT_PLACEHOLDER);
  });

  it('balances are isolated per-mint', async () => {
    // Same EVM user (alice), different mints — different ATAs.
    const aliceUsdcAta = '0xaa111111111111111111111111111111111111111111111111111111111111aa';
    const aliceUsdsAta = '0xbb222222222222222222222222222222222222222222222222222222222222bb';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceUsdcAta);
    await sys.setAtaFor(alice.address, USDS_MINT_PLACEHOLDER, aliceUsdsAta);
    await cpi.setAccountData(aliceUsdcAta, encodeSplTokenAccountData(100_000_000n));
    await cpi.setAccountData(aliceUsdsAta, encodeSplTokenAccountData(500_000_000n));

    expect(await usdcToken.balanceOf(alice.address)).to.equal(100_000_000);
    expect(await usdsToken.balanceOf(alice.address)).to.equal(500_000_000);
  });

  it('allowance state does not cross-contaminate between two instances', async () => {
    await usdcToken.connect(alice).approve(bob.address, 100_000_000);

    expect(await usdcToken.allowance(alice.address, bob.address)).to.equal(100_000_000);
    expect(await usdsToken.allowance(alice.address, bob.address)).to.equal(0);
    expect(await jupUsdToken.allowance(alice.address, bob.address)).to.equal(0);
  });

  it('reverts at constructor when mint_id is zero', async () => {
    const T = await ethers.getContractFactory('UnifiedToken');
    await expect(
      T.deploy(ethers.constants.HashZero, 'Bad', 'BAD', 6, admin.address),
    ).to.be.revertedWith('UnifiedToken: mint cannot be zero');
  });

  it('reverts at constructor when decimals > 18 (sanity bound)', async () => {
    const T = await ethers.getContractFactory('UnifiedToken');
    await expect(
      T.deploy(USDC_MINT_DEVNET, 'Bad', 'BAD', 19, admin.address),
    ).to.be.revertedWith('UnifiedToken: decimals out of range');
  });
});
