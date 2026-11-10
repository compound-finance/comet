# Collateral Delisting

The mechanics of delisting a collateral asset from a Comet market: the factor states, how they are configured, and what each state changes for users, liquidation and collateral sales.

> For when and in what order to use these states in real incidents, see [Delisting Procedure](delisting-procedure.md).

> Reference contracts: [`AssetList`](../contracts/AssetList.sol) (validation), [`Configurator`](../contracts/Configurator.sol) (updates), [`CometWithExtendedAssetList`](../contracts/CometWithExtendedAssetList.sol) (behavior).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Configuration](#2-configuration)
3. [Impact on User Operations](#3-impact-on-user-operations)
4. [Impact on Liquidation](#4-impact-on-liquidation)
5. [Impact on quoteCollateral and buyCollateral](#5-impact-on-quotecollateral-and-buycollateral)
6. [Reference](#6-reference)

---

## 1. Overview

Comet has no "remove asset" function. Once a collateral is listed, its slot in the asset list is permanent. An asset is delisted by setting its **three collateral factors to zero**, one step at a time:

| Factor | Controls | Set to 0 means |
|---|---|---|
| **collateralBCF** (`borrowCollateralFactor`) | Borrow capacity (`isBorrowCollateralized`) | The asset gives no borrowing power |
| **collateralLCF** (`liquidateCollateralFactor`) | Liquidation threshold (`isLiquidatable`) | The asset no longer protects the account from liquidation |
| **collateralLF** (`liquidationFactor`) | Seizure in `absorb`, discount in `buyCollateral` | The asset is not seized, and it is sold without a discount |

Each check **skips a zero-factor asset without reading its price feed**. This is what makes delisting work even when the asset's oracle reverts or reports 0: once its factor is 0, a check can no longer be blocked by that oracle.

Zeroing the factors one by one gives four states:

| State | collateralBCF | collateralLCF | collateralLF | Borrowing power | Protects from liquidation | Seized in `absorb` |
|---|---|---|---|---|---|---|
| **Active** | > 0 | > collateralBCF | > 0 | ✓ | ✓ | ✓ at full value × collateralLF |
| **Soft delist** | 0 | > 0 | > 0 | ✗ | ✓ | ✓ at full value × collateralLF |
| **Liquidation-only** | 0 | 0 | > 0 | ✗ | ✗ | ✓ credited at $0 |
| **Full delist** | 0 | 0 | 0 | ✗ | ✗ | ✗ stays with the borrower |

Delisting is a governance process, not an emergency switch. For an immediate response the pause guardian has [collateral pauses and deactivation](pauses.md).

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 2. Configuration

### Valid factor combinations

The asset list checks the factors when a new implementation is built:

| collateralBCF | collateralLCF | collateralLF | Result |
|---|---|---|---|
| > 0 | > collateralBCF | > 0 | ✓ Active |
| 0 | > 0 | > 0 | ✓ Soft delist |
| 0 | > 0 | 0 | ✓ Accepted, but avoid: counts toward the threshold without being seized |
| 0 | 0 | > 0 | ✓ Liquidation-only |
| 0 | 0 | 0 | ✓ Full delist |
| > 0 | ≤ collateralBCF (including 0) | any | ✗ `BorrowCFTooLarge` |

collateralLF is never checked against the other two factors. Only its upper bound is checked.

On top of that:
- collateralLCF above `MAX_COLLATERAL_FACTOR` reverts with `LiquidateCFTooLarge`.
- collateralLF above `MAX_COLLATERAL_FACTOR` reverts with `LiqPenaltyTooHigh`.

> Factors are stored with 4 decimals (`1e18` → `10000`). Any factor below `1e14` (0.01%) is **stored as 0**, so it behaves exactly like a delisted factor.

### How a change reaches the market

Factor updates are not applied to the live market directly. They are written into the Configurator and take effect when a new implementation, with a new `AssetList`, is deployed and the proxy is upgraded:

```solidity
// 1. Stage the new factors (governor or market admin)
configurator.updateAssetBorrowCollateralFactor(cometProxy, asset, 0);
configurator.updateAssetSupplyCap(cometProxy, asset, 0);

// 2. Build the new implementation and upgrade (proxy admin owner or market admin)
cometProxyAdmin.deployAndUpgradeTo(configuratorProxy, cometProxy);
```

Moving to liquidation-only stages `updateAssetLiquidateCollateralFactor(…, 0)`, and moving to full delist stages `updateAssetLiquidationFactor(…, 0)`.

- **Validation happens at deploy, not in the setters.** Staging factors in a "wrong" intermediate order within one proposal is fine as long as the final set is valid.
- **The price feed must still answer `decimals() == 8` at deploy time**, even for a fully delisted asset. If the original feed is decommissioned so that `decimals()` reverts, replace it (`updateAssetPriceFeed`) as part of the same proposal.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 3. Impact on User Operations

The asset in the examples is delisted COMP. Every other collateral of the account is treated as active. Liquidation-only and full delist affect user operations in the same way. They differ only in liquidation (section 5).

| Operation | Active | Soft delist | Liquidation-only / Full delist |
|---|---|---|---|
| **Supply** the asset | ✓ | ✗ `SupplyCapExceeded` (cap = 0) | ✗ `SupplyCapExceeded` |
| **Withdraw** the asset | ✓ if still collateralized | ✓ if the account's **other** collateral covers the debt | same as soft delist |
| **Transfer** the asset | ✓ if still collateralized | ✓ if the sender's **other** collateral covers the debt. The receiver gets no borrowing power from it. | same as soft delist |
| **Borrow** (withdraw or transfer base) | counts toward capacity | counts as 0 | counts as 0 |
| **Repay**, supply other collateral | ✓ | ✓ | ✓ |
| Account **with no debt** | — | Can withdraw and transfer freely | same |

**Why withdrawing is never harder than it was.** A delisted asset adds 0 to borrowing capacity, so removing it does not change the outcome of the collateral check. If the account passes the check without the asset, the withdrawal goes through. If it does not pass, it already could not borrow, and removing the asset does not change that.

**Supply cap vs the factor.** Nothing in the code stops the supply of an asset just because its collateralBCF is 0. The supply cap (or a [collateral supply pause](pauses.md#4-collateral-pause)) is what closes deposits, so the soft delist step has to set it.

### Example

Alice holds 10 COMP at $100 ($1,000) and owes $700. The factors are collateralBCF 0.80, collateralLCF 0.85 and collateralLF 0.90.

| | Borrow capacity | Liquidation threshold | Alice |
|---|---|---|---|
| Active | $800 | $850 | Can borrow $100 more |
| Soft delist | **$0** | $850 | Not liquidatable, but can't borrow, withdraw base, or transfer base as a borrower. Can repay, or supply another collateral. |
| Liquidation-only / Full delist | $0 | **$0** | Liquidatable ($0 < $700) |

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 4. Impact on Liquidation

Liquidation uses two factors at two different moments:

- `isLiquidatable` values each asset at **collateralLCF**. If it is 0, the asset is skipped and its price is not read.
- `absorb` seizes each asset and credits it at **collateralLF**. If it is 0, the asset is skipped: it is **not seized**, and its price is not read.

`absorb` reuses the prices `isLiquidatable` already read. So an asset skipped by `isLiquidatable` is credited at a price of 0 even if `absorb` seizes it.

| State | collateralLCF | collateralLF | Counts toward threshold | In `absorb` | Where the asset ends up |
|---|---|---|---|---|---|
| Active / Soft delist | > 0 | > 0 | ✓ | Seized, credited at full value × collateralLF | Protocol reserves |
| Avoid | > 0 | 0 | ✓ | Skipped | Stays with the borrower |
| Liquidation-only | 0 | > 0 | ✗ | Seized, **credited at $0**, no oracle read | Protocol reserves |
| Full delist | 0 | 0 | ✗ | Skipped | Stays with the borrower |

In every case the borrower's debt is absorbed. Whatever the seized collateral doesn't cover is paid by reserves, and the borrower's `assetsIn` is reset.

**Continuing the example**, with Alice at $700 of debt:

| State | After `absorb` |
|---|---|
| Soft delist, COMP drops to $80 | The threshold is $800 × 0.85 = $680 < $700, so Alice is liquidatable. The COMP is credited at $800 × 0.90 = $720, which covers the debt, and Alice is left with **$20 of base supply**. The 10 COMP goes to reserves. |
| Liquidation-only | Reserves pay the full $700. **The 10 COMP moves to protocol reserves** and can later be sold through `buyCollateral`. |
| Full delist | Reserves pay the full $700. **Alice keeps her 10 COMP** and can withdraw it, since she has no debt anymore. |

So **while collateralLCF is above 0, borrowers keep what's left of their collateral.** While collateralLCF and collateralLF are still set, an account is liquidated at the asset's real price, and any surplus goes back to the borrower as base. Once collateralLCF is 0, the asset no longer offsets any debt:

- In **liquidation-only** the protocol pays the debt and takes the asset, which it can sell later to recover the loss. The borrower loses the whole asset.
- In **full delist** the protocol pays the debt and gets nothing back. The borrower keeps the asset.

Liquidation-only does not need a working oracle to liquidate: neither `isLiquidatable` nor `absorb` reads the price once collateralLCF is 0. Selling the seized asset later does need a working oracle (section 6).

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 5. Impact on quoteCollateral and buyCollateral

`buyCollateral` sells collateral held in protocol reserves for the base asset, when reserves are below `targetReserves`. The price comes from `quoteCollateral`:

```
discount = storeFrontPriceFactor × (1 − collateralLF)
price    = oraclePrice × (1 − discount)
```

In **liquidation-only**, collateralLF is still above 0, so the seized asset is sold with the normal discount. In **full delist** (collateralLF = 0) **there is no discount**, and the asset is sold at the oracle price. An asset that is not liquidated needs no liquidation incentive. Without this rule the old formula would give the largest possible discount, and with `storeFrontPriceFactor = 100%` a price of 0 and a division-by-zero revert.

**Example.** COMP oracle price $100, `storeFrontPriceFactor` 0.8:

| collateralLF | Discount | Sale price |
|---|---|---|
| 0.90 | 0.8 × 0.10 = 8% | $92 |
| 0.60 | 0.8 × 0.40 = 32% | $68 |
| 0 | none | $100 |

`quoteCollateral` **always reads the asset's price feed**, for any factors. If the feed reverts, `quoteCollateral` and `buyCollateral` revert too. This is intentional: the protocol should not sell an asset whose price it cannot check. To sell seized collateral of a delisted asset, it needs a working feed.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 6. Reference

### Where each factor is read

| Function | Reads | Skips the asset (and its oracle) when |
|---|---|---|
| `isBorrowCollateralized` | collateralBCF | collateralBCF = 0 |
| `isLiquidatable` | collateralLCF | collateralLCF = 0 |
| `absorb` | collateralLF | collateralLF = 0 |
| `quoteCollateral` / `buyCollateral` | collateralLF (discount only) | never. The price is always read. |

### Configurator functions

| Function | Caller |
|---|---|
| `updateAssetBorrowCollateralFactor(cometProxy, asset, value)` | Governor or market admin |
| `updateAssetLiquidateCollateralFactor(cometProxy, asset, value)` | Governor or market admin |
| `updateAssetLiquidationFactor(cometProxy, asset, value)` | Governor or market admin |
| `updateAssetSupplyCap(cometProxy, asset, value)` | Governor or market admin |
| `updateAssetPriceFeed(cometProxy, asset, feed)` | Governor |
| `CometProxyAdmin.deployAndUpgradeTo(configuratorProxy, cometProxy)` | Proxy admin owner or market admin |

### Errors

| Error | Raised when |
|---|---|
| `BorrowCFTooLarge()` | collateralBCF > 0 and collateralBCF ≥ collateralLCF |
| `LiquidateCFTooLarge()` | collateralLCF > `MAX_COLLATERAL_FACTOR` |
| `LiqPenaltyTooHigh()` | collateralLF > `MAX_COLLATERAL_FACTOR` |
| `SupplyCapExceeded()` | Supplying an asset whose supply cap is reached, for example 0 |

### Tests

| Area | File |
|---|---|
| Factor validation and packing | [`test/asset-info-test-asset-list-comet.ts`](../test/asset-info-test-asset-list-comet.ts) |
| collateralBCF = 0 in the borrow check | [`test/is-borrow-collateralized-test.ts`](../test/is-borrow-collateralized-test.ts) |
| collateralLCF = 0 in the liquidation check | [`test/is-liquidatable-test.ts`](../test/is-liquidatable-test.ts) |
| collateralLF combinations in absorb | [`test/absorb-test.ts`](../test/absorb-test.ts) |
| Discount and oracle behavior | [`test/quote-collateral-test.ts`](../test/quote-collateral-test.ts) |

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>
