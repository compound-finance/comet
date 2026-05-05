# UnifiedToken — operator notes

`UnifiedToken<Mint>` (`contracts/unified-token/UnifiedToken.sol`) is a generic
ERC-20 wrapper around any Solana SPL mint. Same compiled artifact serves
Compound's USDC base, Sky's USDS, Jupiter's JupUSD, etc. — instantiate with
the appropriate Solana mint pubkey at construction.

This file documents the SPL-delegate semantics that surfaced during Phase 2 +
Phase 3 of the Compound on Rome build and that any successor lending /
trading / RWA protocol needs to be aware of when integrating.

## Two transfer modes

**EVM-lane CPI mode** (`transfer` / `transferFrom`): contract issues a signed
CPI to SPL Token's `transfer_checked`. Authority signer is the
`AUTHORITY_PDA(spender)` per Rome's CPI precompile contract. For
`transferFrom(from, to, amount)`, this means SPL Token sees the spender as
`AUTHORITY_PDA(spender)` and requires that spender to have prior delegate
authority on `from`'s ATA. UnifiedToken's `approve(spender, value)` mirrors
the EVM allowance write into a Solana CPI to SPL Token's `Approve` instruction
to set up that delegate.

**Solana-lane verify mode** (`transferFromPreDeposited`): no CPI.
`snapshotAta(ata)` records the current ATA balance; some other ix (the Solana
orchestrator program's first instruction in the same Solana tx) actually
moves the SPL tokens; then `transferFromPreDeposited` confirms the post-balance
exceeds the snapshot by `value` and emits a matching `Transfer` event. Skips
the SPL CPI entirely, which is why Phase 3 routes Compound's `supply` through
this path (closes the Q1 1.4M-CU gate).

## Q3: SPL delegate clobbering across protocols

UnifiedToken's `approve(spender, value)` overwrites the SPL delegate. SPL
Token's `Approve` instruction does NOT accumulate; it sets
`delegate=AUTHORITY_PDA(spender)` and `delegatedAmount=value`, replacing
whatever was there before.

Implication for users + protocols:

```
1. User calls UnifiedToken.approve(Compound, 100)
   → On-chain: AUTHORITY_PDA(user)'s ATA delegate = AUTHORITY_PDA(Compound),
     delegatedAmount = 100.

2. User calls UnifiedToken.approve(Pendle, 200)
   → On-chain: AUTHORITY_PDA(user)'s ATA delegate = AUTHORITY_PDA(Pendle),
     delegatedAmount = 200. The Compound delegate is GONE (overwritten).

3. User calls Compound.supply(USDC, 50)
   → Compound's transferFrom CPI signs as AUTHORITY_PDA(Compound), but the
     SPL delegate now points at AUTHORITY_PDA(Pendle). SPL Token rejects with
     OwnerMismatch → Comet reverts with a `Custom(4)` from the inner CPI.
```

In Phase 2 of Compound on Rome we observed this exact failure mode: a
deployer who called `approve(comet)` then `approve(simplePullProxy)` and
finally `cometProxy.supply` saw `mollusk error: Failure(Custom(4))` because
the SPL delegate was clobbered by the second approve.

### What this DOESN'T break

Single-protocol use is unaffected. A user who ONLY interacts with Compound
on Rome will never see this — the delegate stays pointed at Compound the
whole time.

The EVM allowance is also accurate: `allowance(user, Pendle) = 200` reflects
what the user *intended*. The SPL delegate is a per-Solana-account honor
system; the EVM allowance is the protocol-side cap.

### What this DOES break

Multi-protocol composition where two protocols both use `transferFrom` for
their pull pattern. Concrete example: a user supplies to Compound on Rome,
then later calls a Morpho-on-Rome integration that also calls
`transferFrom(user, morpho, ...)`. Without re-approving Compound, the next
Compound supply will revert.

The mitigation is straightforward: **users must re-approve before each
protocol's pull**, OR protocols can use the `transferFromPreDeposited` mode
(which the Solana lane uses, no SPL delegate involved).

### Recommended pattern for new integrations

For protocols deploying on Rome that need to pull via UnifiedToken:

| Pattern | When to use | Cost |
|---|---|---|
| `transferFrom` (EVM-lane CPI) | Single-protocol UX (Compound only) | Each `approve` clobbers prior delegates; protocol-by-protocol re-approve required for cross-app composition |
| `transferFromPreDeposited` (Solana-lane verify) | Composing multiple protocols, or cross-VM dispatch via the Solana orchestrator | None — no SPL delegate in play; balance-delta is the source of truth |
| `safeTransferFrom` via a per-user manager (e.g. Comet's `allow(manager, true)`) | Manager-mediated flows where one manager pulls for many users | One-time setup; manager pre-approved across protocols |

Compound's `supply` path on Rome uses the `transferFromPreDeposited` mode
when invoked through the OrchestratorRouter, which is why the Solana lane
doesn't see this issue. The EVM-lane Compound supply still uses
`transferFrom`, so users supplying directly via MetaMask after a CCTP burn
will see the delegate pattern.

### Why not inverse the design?

Two alternatives that don't work:

1. **Do NOT touch the SPL delegate from approve().** Then `transferFrom` reverts
   with OwnerMismatch unless the user explicitly does the SPL approve via a
   Solana wallet, which would force every EVM-lane user to also have a
   funded Solana wallet — defeats the EVM-lane UX.

2. **Per-spender delegate slot on SPL Token.** Doesn't exist. SPL Token has
   ONE delegate per ATA. Token-2022 has the same model (extensions
   notwithstanding).

So we live with the clobbering. The trade-off is:
- (+) EVM-lane works without separate Solana wallet for the user
- (–) cross-protocol composition requires careful sequencing

### Future fix: ed25519-precompile for permit-style SPL delegation

If the spec's Q2 hybrid-derivation path is ever shipped (using an
ed25519-verify precompile to let users sign Solana-side authorizations in
their EVM wallet), this whole issue dissolves: each protocol can carry its
own user-signed permit at supply time, no delegate state needed.

This is tracked as a future enhancement in the spec at
[`rome-specs/active/technical/2026-05-04-compound-on-rome-unified-usdc.md`](../../../rome-specs/active/technical/2026-05-04-compound-on-rome-unified-usdc.md)
§Q2.

## Reference: source files

- `UnifiedToken.sol` (lines 162-235) — transfer/approve semantics
- `UnifiedToken.sol` (lines 264-299) — pre-deposited verify mode
- `UnifiedToken.sol` (lines 462-531) — `_approveSplDelegate` + `_revokeSplDelegate`
- `Comet.sol` (lines 800-828) — V3 doTransferIn pre-deposited branch
