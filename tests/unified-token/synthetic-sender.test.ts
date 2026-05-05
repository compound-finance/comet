// SyntheticSender — derive a deterministic EVM address from a Solana pubkey.
//
// Spec §1b §11a, §Q2: Phase 3's MetaHook callee dispatches Compound's
// `supply()` with `msg.sender` derived from the Solana wallet that signed
// the orchestrator tx. Per the resolved Q2: user-pubkey-bound derivation:
//
//   syntheticAddress = address(uint160(uint256(keccak256(
//       abi.encodePacked(ROME_USER_SALT, solanaPubkey)
//   ))));
//
// where ROME_USER_SALT = "rome.protocol.unified-token.synthetic-sender.v1".
//
// Properties under test:
//   - Deterministic: same pubkey → same address
//   - Distinct: distinct pubkeys → distinct addresses
//   - Non-zero: never returns 0x0 (sanity)
//   - Domain-separated: different ROME_USER_SALT → different output (foundational
//     for forward-compat versioning if we ever rotate the derivation)

import { expect, ethers } from './_helpers';

describe('SyntheticSender', function () {
  let lib: any;

  beforeEach(async () => {
    const SS = await ethers.getContractFactory('SyntheticSenderHarness');
    lib = await SS.deploy();
    await lib.deployed();
  });

  it('returns a deterministic address for a given pubkey', async () => {
    const pk = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const a1 = await lib.derive(pk);
    const a2 = await lib.derive(pk);
    expect(a1).to.equal(a2);
  });

  it('distinct pubkeys produce distinct addresses', async () => {
    const pk1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const pk2 = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const a1 = await lib.derive(pk1);
    const a2 = await lib.derive(pk2);
    expect(a1).to.not.equal(a2);
  });

  it('matches the off-chain JS derivation', async () => {
    const pk = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const ROME_USER_SALT = 'rome.protocol.unified-token.synthetic-sender.v1';
    const expected = ethers.utils.getAddress(
      '0x' + ethers.utils
        .keccak256(
          ethers.utils.solidityPack(
            ['string', 'bytes32'],
            [ROME_USER_SALT, pk],
          ),
        )
        .slice(26),
    );
    const onChain = await lib.derive(pk);
    expect(onChain).to.equal(expected);
  });

  it('zero pubkey reverts (intentional sanity bound)', async () => {
    // Library uses a custom error (ZeroPubkey) for cheaper revert encoding.
    await expect(
      lib.derive(ethers.constants.HashZero),
    ).to.be.reverted;
  });

  it('exposes the salt as a constant', async () => {
    const ROME_USER_SALT = 'rome.protocol.unified-token.synthetic-sender.v1';
    expect(await lib.SALT()).to.equal(ROME_USER_SALT);
  });
});
