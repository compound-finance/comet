// UnifiedToken — IERC20Metadata: decimals / symbol / name.
//
// `decimals()` matches the underlying SPL mint decimals. Constructor reads the
// mint via SystemProgram.account_info during construction; subsequent reads
// are cheap (immutable).
//
// `symbol()` and `name()` are constructor-supplied strings. Per the Rome
// nomenclature standard (rome-solidity/CLAUDE.md), Compound's deployment
// passes "USDC" — same as Solana's USDC display. Other deployments (USDS,
// JupUSD) use their own symbols.

import {
  expect, ethers,
  installMockPrecompiles,
  USDC_MINT_DEVNET,
  USDS_MINT_PLACEHOLDER,
} from './_helpers';

describe('UnifiedToken — IERC20Metadata', function () {
  let sys: any;
  let cpi: any;
  let admin: any;

  beforeEach(async () => {
    [admin] = await ethers.getSigners();
    ({ sys, cpi } = await installMockPrecompiles());
  });

  it('decimals matches constructor argument', async () => {
    const T = await ethers.getContractFactory('UnifiedToken');
    const token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    expect(await token.decimals()).to.equal(6);
  });

  it('decimals can be set per-deployment (e.g. 9 for jitoSOL)', async () => {
    const T = await ethers.getContractFactory('UnifiedToken');
    const token = await T.deploy(USDC_MINT_DEVNET, 'Unified jitoSOL', 'jitoSOL', 9, admin.address);
    expect(await token.decimals()).to.equal(9);
  });

  it('symbol returns constructor symbol', async () => {
    const T = await ethers.getContractFactory('UnifiedToken');
    const token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    expect(await token.symbol()).to.equal('USDC');
  });

  it('name returns constructor name', async () => {
    const T = await ethers.getContractFactory('UnifiedToken');
    const token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    expect(await token.name()).to.equal('Unified USDC');
  });

  it('mintId is immutable and matches constructor', async () => {
    const T = await ethers.getContractFactory('UnifiedToken');
    const token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    expect(await token.mintId()).to.equal(USDC_MINT_DEVNET);

    const token2 = await T.deploy(USDS_MINT_PLACEHOLDER, 'Unified USDS', 'USDS', 6, admin.address);
    expect(await token2.mintId()).to.equal(USDS_MINT_PLACEHOLDER);
  });
});
