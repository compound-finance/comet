# Partial Liquidation — Revert Cases and Open Issues

This document describes the conditions under which the partial liquidation flow in `CometWithPartialLiquidation.sol` reverts, and what needs to be resolved for the implementation to work correctly.

---

## Entry point: `absorb(address absorber, address[] calldata accounts)`

### 1. `Paused()` — Absorb functionality is paused

**Location**: `absorb()`, line 1042

```solidity
if (isAbsorbPaused()) revert Paused();
```

**Condition**: The `pauseGuardian` or `governor` has set the absorb pause flag.

**Impact**: All accounts in the batch are blocked. No absorb can proceed until unpaused.

---

### 2. `TimestampTooLarge()` — Block timestamp overflow guard

**Location**: `getNowInternal()` → called from `accrueInternal()` → called from `absorb()`

```solidity
if (block.timestamp >= 2**40) revert TimestampTooLarge();
```

**Condition**: `block.timestamp >= 2^40` (approximately year 36812).

**Impact**: Effectively impossible in practice, but exists as a safety guard.

---

## Per-account: `absorbInternal(address absorber, address account)`

### 3. `NotLiquidatable()` — Account is not eligible for liquidation

**Location**: `absorbInternal()`, line 1080

```solidity
if (!isLiquidatable(account)) revert NotLiquidatable();
```

This reverts in two sub-cases (from `isLiquidatable()`):

#### 3a. Account has no debt
```solidity
if (principal >= 0) return false;
```
The account is a net supplier or has a zero balance — no debt to liquidate.

#### 3b. Account is sufficiently collateralized
```solidity
return (debt + int(_getLiquidity(account, true)) < 0);
```
The weighted collateral value (using `liquidateCollateralFactor` for each asset) is sufficient to cover the outstanding debt. The account is above water.

---

### 4. `BadPrice()` — Price feed returned an invalid price

**Location**: `getPrice(address priceFeed)`, line 355. Called multiple times inside `absorbInternal()`.

```solidity
if (price <= 0) revert BadPrice();
```

**Condition**: Any price feed returns a price of `0` or negative.

**Affected calls inside `absorbInternal()`**:
- `getPrice(baseTokenPriceFeed)` — base token price (used for debt valuation and final balance calculation)
- `getPrice(assetInfo.priceFeed)` — each collateral asset's price feed (called in both pre-calculation loops)

**Impact**: If any price feed is stale, returns zero, or is malformed, the entire absorb transaction reverts.

---

### 5. Arithmetic panic — Division by zero in `expectedHF` calculation

**Location**: `absorbInternal()`, line 1149 (inside main liquidation loop)

```solidity
liquidationData.expectedHF = (
    (liquidationData.totalCollaterizedValue - liquidationData.collaterizationValue) * FACTOR_SCALE
) / (uint256(-debt) - deltaValue - liquidationData.seizedValue);
```

**Condition**: The denominator equals zero, i.e.:

```
uint256(-debt) - deltaValue == liquidationData.seizedValue
```

This means the seized value of the current collateral asset (at its `liquidationFactor`) would **exactly** cover all remaining debt. It is a pathological edge case at fixed-point precision, but Solidity 0.8+ will panic and revert on integer division by zero.

---

### 6. Arithmetic panic — Underflow in partial seizure denominator

**Location**: `absorbInternal()`, line 1174 (inside the `totalCollaterizedValue2 >= requiredCollateralValue` branch)

```solidity
liquidationData.seizedValue = (
    liquidationData.totalCollaterizedValue2 - requiredCollateralValue
) * FACTOR_SCALE / (mulFactor(assetInfo.liquidationFactor, targetHF) - assetInfo.borrowCollateralFactor);
```

**Condition**:

```
liquidationFactor * targetHF / 1e18 <= borrowCollateralFactor
```

**When this happens**: When `targetHF` is configured too low relative to the ratio of `borrowCollateralFactor` to `liquidationFactor` for the given asset.

**Example**: If `liquidationFactor = 0.95e18` and `borrowCollateralFactor = 0.85e18`, then for the formula to be valid:

```
targetHF > borrowCollateralFactor / liquidationFactor = 0.85 / 0.95 ≈ 0.894e18
```

If `targetHF` is set at or below `~0.894e18`, the subtraction underflows (Solidity 0.8 reverts with arithmetic panic). If the values are exactly equal, it is a division by zero.

**Impact**: This is a **configuration-level risk** — setting `targetHF` too low in `ConfiguratorPartialLiquidation` can permanently brick partial liquidation for any asset where the above inequality holds.

---

## Summary table

| Error | Location | Trigger condition |
|---|---|---|
| `Paused()` | `absorb()` | Absorb pause flag is set |
| `TimestampTooLarge()` | `getNowInternal()` | `block.timestamp >= 2^40` |
| `NotLiquidatable()` | `absorbInternal()` | Account has no debt, or is above water at `liquidateCollateralFactor` |
| `BadPrice()` | `getPrice()` | Any price feed returns `<= 0` |
| Arithmetic panic (div/0) | `absorbInternal()` L1149 | Seized value from current asset exactly equals remaining debt |
| Arithmetic panic (underflow or div/0) | `absorbInternal()` L1174 | `liquidationFactor * targetHF / 1e18 <= borrowCollateralFactor` |

---

## Open issues

### Test suite status

| Result | Count |
|---|---|
| Passing | 10 |
| Failing | 4 |

### Failing tests — metric mismatch between algorithm and `isLiquidatable`

**Failing tests** (all fail with `AssertionError: expected false to be true`):
- `should successfully absorb user with multiple collaterals`
- `should successfully absorb user with multiple collaterals - sufficient last collateral only`
- `should successfully absorb user with multiple collaterals - insufficient last collateral`
- `should successfully absorb user with insufficient collaterals`

Each test calls `absorb()` and then asserts `expect(finalIsLiquidatable).to.be.true` — i.e., the account should **still be liquidatable** after the partial absorb. The implementation currently returns `false`.

#### Root cause

The algorithm and `isLiquidatable` use **different collateral weighting factors**:

| Component | Factor used |
|---|---|
| `totalCollaterizedValue` (algorithm, `expectedHF` numerator) | `borrowCollateralFactor` |
| `isLiquidatable` / `_getLiquidity(account, true)` | `liquidateCollateralFactor` |

In all standard asset configurations, `liquidateCollateralFactor > borrowCollateralFactor`. Therefore, after a partial absorb that brings the `borrowCF`-based health factor to `targetHF = 1.05`:

```
liquidateCF-weighted collateral / remaining_debt
  >= (borrowCF-weighted collateral / remaining_debt) × (liquidateCF / borrowCF)
  = 1.05 × (liquidateCF / borrowCF)
```

Using the test asset parameters (COMP: `liquidateCF=0.85`, `borrowCF=0.80`; WETH: `liquidateCF=0.80`, `borrowCF=0.75`):

```
min(liquidateCF / borrowCF) = min(0.85/0.80, 0.80/0.75) = 1.0625

liquidateCF-weighted / debt >= 1.05 × 1.0625 ≈ 1.115 > 1.0
```

The account is always brought out of the liquidatable zone when the absorb reaches `targetHF = 1.05` at `borrowCF` weighting, so `isLiquidatable` returns `false`.

#### What needs to be decided

**Option A — Account should NOT remain liquidatable after absorb** (current behavior):
The 4 test expectations (`finalIsLiquidatable = true`) are incorrect and should be changed to `false`. The partial absorb is "partial" in the sense that it only seizes the minimum collateral needed to reach `targetHF`, not that the account is left in a still-underwater state.

**Option B — Account SHOULD remain liquidatable after absorb** (test intent):
The algorithm should use `liquidateCollateralFactor` instead of `borrowCollateralFactor` for `totalCollaterizedValue`, so that `targetHF` is measured against the same metric as `isLiquidatable`. In that case, reaching `targetHF = 1.05` means the account is only marginally above the liquidation threshold and can still be liquidated on the next price drop.
