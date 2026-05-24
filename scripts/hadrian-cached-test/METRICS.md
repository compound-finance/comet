# Compound v3 (Comet) on Rome — cached-wrapper composition metrics

Empirical measurements from two gamuts run on Hadrian (chain id 200010) against the **canonical `compound-on-rome-comet` Comet** deployed with **`SPL_ERC20_cached` wrappers** as both base + collateral assets.

Per-action metrics captured via `rome_solanaTxForEvmTx` + Rome's Cherry follower (no rate limits) — same instrumentation pattern as the rome-uniswap-v3 + rome-aave-v3 gamuts.

---

## Test session summary

| Variant | Comet proxy | Collats | Result | Script |
|---|---|---|---|---|
| **single-collat** | `0xC6989ECe86eF2344fdbd577171944D3e4fAe1b2a` | cached wETH | 19/20 PASS | `gamut.ts` |
| **5-collat heavy case** | `0xF4f214c5C54C3F9B7BA1339e4f68cd6bd2F91736` | cached wETH + wHEAT + wSALT + wMILK + wOIL | 32/33 PASS | `gamut-5collat.ts` |

### Cached SPL_ERC20 wrappers used

| Symbol | Address | Decimals | Source |
|---|---|---:|---|
| wUSDC (base) | `0x33fb7AD189B0A59CCAFcC3337F3a8B61e3719912` | 6 | existing (rome-solidity #210) |
| wETH | `0x09A9B33501f2cf1E42dF14c6EcE1F7EDE8376366` | 8 | existing |
| wHEAT | `0x09B313A5C39BA64FCc4f83F134021D7423787D1e` | 9 | new (this PR, via ERC20SPLFactory) |
| wSALT | `0x0b0AF4D452c1b8fc1270AD5A6d1d62044d412ff4` | 9 | new |
| wMILK | `0x2197cB9786bee9AfDe53FD2081973185fcd8D586` | 9 | new |
| wOIL | `0x00449c4582598450cD7eb9fA42EE2B9424589449` | 9 | new |

Bootstrap flow (per new wrapper): `factory.create_token_mint()` → `factory.init_token_mint(mint)` → `factory.add_spl_token_no_metadata(mint, name, symbol)` → `wrapper.mint_to(deployer, 1M × 10^9)`. Source: [`bootstrap-5-cached.ts`](./bootstrap-5-cached.ts).

---

## Single-collat gamut — 19/20 PASS

20-step gamut covering signer-side mainline (Phase 1–7) + 2-EOA TRUE borrow (Phase 8).

### Per-action metrics

| Action | Wall(s) | Iter sigs | Sol CU | Max heap | Slot span |
|---|---:|---:|---:|---:|---:|
| `wETH.approve(comet)` | 8.0 | 2 | 225,677 | 32,456 | 3 |
| `wUSDC.approve(comet)` | 7.3 | 2 | 234,995 | 32,456 | 2 |
| `comet.supply(wETH, 100)` [collat] | 8.4 | 2 | 834,711 | 121,888 | 3 |
| `comet.supply(wUSDC, 5000)` [base] | 7.5 | 2 | 937,823 | 130,560 | 3 |
| `comet.withdraw(wUSDC, 1000)` [pseudo-borrow] | 7.2 | 2 | 752,955 | 97,864 | 2 |
| `comet.supply(wUSDC, 1010)` [repay] | 7.3 | 2 | 939,482 | 130,560 | 3 |
| `comet.withdraw(wETH, 100)` [withdraw collat] | 7.3 | 2 | 639,102 | 96,400 | 3 |
| **`comet.withdraw(wUSDC, 1000)` [TRUE borrow, 2-EOA]** | **20.3** | **1** | **992,420** | **117,720** | **0** |
| `comet.supply(wUSDC, 1010)` [borrower repay] | 7.5 | 2 | 941,370 | 129,112 | 2 |
| `comet.withdraw(wETH, 100)` [borrower exits collat] | 7.5 | 2 | 639,365 | 94,952 | 2 |

The one FAIL: `comet.withdraw(wUSDC, max)` at Phase 7 — signer's `cBase` balance had accrued interest making it slightly larger than the pool's liquid wUSDC inventory. Cleanup quirk, not a cached-wrapper composition issue.

---

## 5-collat heavy-use-case gamut — 32/33 PASS

33-step gamut: signer supplies base liquidity, borrower wallet generated + funded with each of 5 cached collats + native gas, borrower supplies all 5 collats, withdraws base (TRUE multi-collat borrow), repays, withdraws all 5 collats sequentially.

### Phase 6 — borrower supplies all 5 cached collats (CU growth as `assetsIn` bitmap fills)

| Supply # | Asset | Sol CU | Heap | Bitmap before |
|---|---|---:|---:|---|
| 1st | wETH | **855,635** | 124,360 | `0b00000` (empty) |
| 2nd | wHEAT | 898,277 | 125,824 | `0b00001` |
| 3rd | wSALT | 985,774 | 127,592 | `0b00011` |
| 4th | wMILK | 1,020,819 | 126,016 | `0b00111` |
| 5th | wOIL | **1,066,060** | 132,256 | `0b01111` |

**Per-added-collat CU overhead**: avg ~52K per added collat. Linear scaling — Compound's `assetsIn`-bitmap walk + per-asset balance read is cheap.

After Phase 6: `borrower.assetsIn = 0b11111` (5 collats registered).

### 🎯 Phase 7 — TRUE multi-collat borrow (the headline measurement)

| Operation | Iter sigs | **Sol CU** | **Max heap** | Wall |
|---|---:|---:|---:|---:|
| `comet.withdraw(wUSDC, 100000)` [TRUE borrow, 5 collats backing] | **1** | **1,160,517** | **128,912** | **19.9s** |

Comet walks all 5 collats in `getBorrowLiquidity` for capacity check. **Fits in a single Solana sig** at 1.16M CU — 17% headroom under the 1.4M-CU per-sig cap.

`borrower.borrowBalanceOf == 100000` confirmed post-tx.

### Phase 8 — repay

| Action | Sol CU | Heap | Wall |
|---|---:|---:|---:|
| `comet.supply(wUSDC, 100500)` [borrower repay] | 955,723 | 129,112 | 8.3s |

`borrowBalanceOf == 0` after.

### Phase 9 — sequential collateral withdraws (5x)

| Withdraw # | Asset | Sol CU | Heap |
|---|---|---:|---:|
| 1st | wETH | **644,563** | 94,952 |
| 2nd | wHEAT | 703,051 | 95,048 |
| 3rd | wSALT | 772,579 | 98,216 |
| 4th | wMILK | 830,044 | 98,312 |
| 5th | wOIL | **857,292** | 98,408 |

Same linear ~53K CU/collat scaling as supply.

---

## Cross-protocol comparison on Hadrian (all cached SPL_ERC20)

| Operation | UV3 | Aave V3 | Compound 1-collat | **Compound 5-collat** |
|---|---:|---:|---:|---:|
| token approve | 2 sigs / 230K CU | 2 sigs / 225K CU | 2 sigs / 232K CU | 2 sigs / 230K CU |
| supply base | — | 1 sig / 1.18M CU | 2 sigs / 938K CU | 2 sigs / 951K CU |
| supply collat | — | 1 sig / 1.15M CU (wETH) | 2 sigs / 835K CU (wETH) | 2 sigs / 855K → 1.07M CU |
| **TRUE borrow** | — | **28 sigs / 6.46M CU** | **1 sig / 992K CU** | **1 sig / 1.16M CU** |
| repay | — | 1 sig / 1.27M CU | 2 sigs / 941K CU | 2 sigs / 956K CU |
| withdraw collat | — | (same path) | 2 sigs / 639K CU | 2 sigs / 645K → 857K CU |
| swap exactIn | 26 sigs / 3.82M CU | — | — | — |
| mint LP NFT position | 36 sigs / 6.94M CU | — | — | — |
| liquidation | — | 38 sigs / 10.05M CU | not tested | not tested |
| flash loan | — | 22 sigs / 4.47M CU | n/a (no native flashLoan) | n/a |

### Key empirical findings

1. **Compound v3's 5-collat borrow stays in a single Solana sig** at 1.16M CU — Aave V3's single-collat borrow takes 28 sigs / 6.46M CU. Compound's design is **5.6× more efficient on Solana CU** even when stressed at 5x the collateral count.
2. **Linear per-collat scaling**: each added collat adds ~52K CU to supply and ~53K CU to withdraw. At this rate, Compound v3 could handle ~9 collats before any single operation hits the 1.4M-CU sig cap (theoretical ceiling ~16 per Comet's `uint16 assetsIn`).
3. **Heap stays bounded** at ~130K across all operations (Solana limit 256K — half-utilization, plenty of headroom).
4. **All 6 cached SPL_ERC20 wrappers compose cleanly with Compound v3** — same SPL CPI flow as single-collat. No track conflicts, no `verify_call` issues. Cached SPL_ERC20 + Compound is empirically validated as a clean composition pattern.

---

## Wall-clock totals

| Run | Steps | PASS/FAIL | Total wall |
|---|---:|---|---:|
| single-collat | 20 | 19/20 | ~2:30 min |
| 5-collat | 33 | 32/33 | ~4:30 min |

## Solana per-sig caps utilization

| Cap | Limit | Max observed (5-collat) | Headroom |
|---|---:|---:|---:|
| Solana CU per sig | 1,400,000 | 1,160,517 (Phase 7 borrow) | **17%** |
| Solana heap per sig | 262,144 bytes | 132,256 bytes (Phase 6 supply #5) | **48%** |
| Iter sigs per EVM tx (Compound) | n/a structurally bounded | 2 (most ops); 1 (borrow / supply lender) | n/a |

Plenty of envelope left for more complex multi-asset operations.

---

## Reproduce

Prerequisites:
- Hadrian `ETH_PK` set in env or `~/rome/.secrets/hadrian/deployer.json`
- Hardhat 2 (this repo's existing toolchain)

```bash
# 1. Bootstrap 4 new cached SPL_ERC20 wrappers (wHEAT, wSALT, wMILK, wOIL)
#    Idempotent — skips wrappers that already exist
npx hardhat run scripts/hadrian-cached-test/bootstrap-5-cached.ts --network hadrian

# 2. Deploy fresh Comet variant with cached wUSDC base + 5 cached collats
npx hardhat run scripts/hadrian-cached-test/deploy-5collat.ts --network hadrian

# 3. Run the 5-collat heavy-use-case gamut
npx hardhat run scripts/hadrian-cached-test/gamut-5collat.ts --network hadrian
```

Reusable: the deploy + gamut scripts read the local `cached-wrappers.json` + `state-5collat.json` so you can re-run the gamut against the existing deployment without redeploying.

## Deployment receipts

| File | Contents |
|---|---|
| [`state.json`](./state.json) | Single-collat Comet addresses |
| [`state-5collat.json`](./state-5collat.json) | 5-collat Comet + 5 price feed addresses |
| [`cached-wrappers.json`](./cached-wrappers.json) | New cached SPL_ERC20 wrappers (wHEAT/wSALT/wMILK/wOIL) addresses + mints |
