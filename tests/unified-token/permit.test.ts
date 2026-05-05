// UnifiedToken — ERC-2612 permit (gasless approvals).
//
// Permit lets a user sign an EIP-712 typed-data approval off-chain, and any
// relayer submits it on-chain. Critical for the Solana-lane orchestrator path:
// Phase 3's MetaHook callee can run a permit + transferFromPreDeposited sequence
// without the supplier holding any Rome gas balance.
//
// Conformance: matches OZ ERC20Permit. DOMAIN_SEPARATOR / nonces / permit
// signatures interoperate with off-chain ERC-2612 libraries.

import {
  expect, ethers,
  installMockPrecompiles,
  encodeSplTokenAccountData,
  USDC_MINT_DEVNET,
  signPermit,
} from './_helpers';

describe('UnifiedToken — ERC-2612 permit', function () {
  let token: any;
  let sys: any;
  let cpi: any;
  let admin: any;
  let alice: any;
  let bob: any;
  let chainId: number;

  beforeEach(async () => {
    [admin, alice, bob] = await ethers.getSigners();
    ({ sys, cpi } = await installMockPrecompiles());

    const T = await ethers.getContractFactory('UnifiedToken');
    token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    await token.deployed();

    chainId = (await ethers.provider.getNetwork()).chainId;

    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(1_000_000_000n));
  });

  it('permit() sets allowance from a valid signature', async () => {
    const value = ethers.BigNumber.from(100_000_000);
    const nonce = await token.nonces(alice.address);
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const sig = await signPermit(alice, token, alice.address, bob.address, value, nonce, deadline, chainId);

    await expect(
      token.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s),
    ).to.emit(token, 'Approval').withArgs(alice.address, bob.address, value);

    expect(await token.allowance(alice.address, bob.address)).to.equal(100_000_000);
  });

  it('permit() reverts on expired deadline', async () => {
    const value = ethers.BigNumber.from(100_000_000);
    const nonce = await token.nonces(alice.address);
    const deadline = Math.floor(Date.now() / 1000) - 1;
    const sig = await signPermit(alice, token, alice.address, bob.address, value, nonce, deadline, chainId);

    await expect(
      token.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s),
    ).to.be.revertedWith('ERC20Permit: expired deadline');
  });

  it('permit() reverts on wrong signer', async () => {
    const value = ethers.BigNumber.from(100_000_000);
    const nonce = await token.nonces(alice.address);
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Bob signs but claims to be Alice.
    const sig = await signPermit(bob, token, alice.address, bob.address, value, nonce, deadline, chainId);

    await expect(
      token.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s),
    ).to.be.revertedWith('ERC20Permit: invalid signature');
  });

  it('nonce increments after each successful permit', async () => {
    const value = ethers.BigNumber.from(100_000_000);
    let nonce = await token.nonces(alice.address);
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    let sig = await signPermit(alice, token, alice.address, bob.address, value, nonce, deadline, chainId);
    await token.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s);

    expect(await token.nonces(alice.address)).to.equal(nonce.add(1));

    nonce = await token.nonces(alice.address);
    sig = await signPermit(alice, token, alice.address, bob.address, value.mul(2), nonce, deadline, chainId);
    await token.permit(alice.address, bob.address, value.mul(2), deadline, sig.v, sig.r, sig.s);

    expect(await token.allowance(alice.address, bob.address)).to.equal(value.mul(2));
  });

  it('replay attack with same signature reverts', async () => {
    const value = ethers.BigNumber.from(100_000_000);
    const nonce = await token.nonces(alice.address);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const sig = await signPermit(alice, token, alice.address, bob.address, value, nonce, deadline, chainId);

    await token.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s);

    await expect(
      token.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s),
    ).to.be.revertedWith('ERC20Permit: invalid signature');
  });

  it('DOMAIN_SEPARATOR is deterministic per chainId', async () => {
    const ds = await token.DOMAIN_SEPARATOR();
    expect(ds).to.match(/^0x[0-9a-fA-F]{64}$/);
  });
});
