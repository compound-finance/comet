# Utilization

What utilization is in Comet, how it sets interest rates, how it can go above 100%, and the 200% cap on new borrowing.

> Reference contract: [`CometWithExtendedAssetList`](../contracts/CometWithExtendedAssetList.sol).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Interest Rate Curve](#2-interest-rate-curve)
3. [Utilization Above 100%](#3-utilization-above-100)
4. [The 200% Cap](#4-the-200-cap)
5. [Empty and No-Borrow Markets](#5-empty-and-no-borrow-markets)
6. [Reference](#6-reference)

---

## 1. Overview

**Utilization** is the share of the base asset that lenders supplied and borrowers are now using:

```
utilization = totalBorrow / totalSupply
```

Both totals are present values, so accrued interest is included. The result is scaled to `1e18`, so 100% is `1e18`. If there is no supply, utilization is 0.

Utilization is the one input to the interest rate model. Every time the market accrues, it reads the current utilization, computes a supply rate and a borrow rate from it, and grows the supply and borrow indices at those rates. High utilization means expensive borrowing and well-paid lending. The high borrow rate pushes borrowers to repay, and the high supply rate attracts new lenders, so utilization is pulled back down.

`getUtilization()` reads the stored indices and does not accrue first. Inside a user action the market accrues before it checks utilization, so those checks always see the current value.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 2. Interest Rate Curve

Supply and borrow each have their own curve, with the same shape. It has a flat **base** rate, a gentle **low slope** up to the **kink**, and a steep **high slope** after it:

```
if utilization ≤ kink:
    rate = base + slopeLow × utilization
else:
    rate = base + slopeLow × kink + slopeHigh × (utilization − kink)
```

```mermaid
xychart-beta
    title "Borrow APR vs utilization (example curve)"
    x-axis "Utilization %" [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200]
    y-axis "APR %" 0 to 70
    line [1, 2, 3, 4, 5, 11, 17, 23, 29, 35, 41]
```

The curve keeps going past 100%. Nothing flattens it, so the rate keeps rising as long as utilization does.

The eight parameters (`supplyKink`, `supplyPerYearInterestRateBase`, `…SlopeLow`, `…SlopeHigh`, and the same four for borrow) are set per year in the market configuration. The constructor divides them by `SECONDS_PER_YEAR` (31,536,000) and stores per-second values, and interest accrues every second.

**Example.** A borrow curve with kink 80%, base 1%, low slope 5% and high slope 30%:

| Utilization | Borrow APR |
|---|---|
| 50% | 1% + 5% × 0.5 = **3.5%** |
| 80% | 1% + 5% × 0.8 = **5%** |
| 90% | 1% + 5% × 0.8 + 30% × 0.1 = **8%** |
| 150% | 1% + 5% × 0.8 + 30% × 0.7 = **26%** |

Two new short-circuits come before the curve:

- **No borrows → borrow rate is 0.** An empty borrow side has no one to charge.
- **No supply → supply rate is 0.** An empty supply side has no one to pay.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 3. Utilization Above 100%

A market holds more base asset than lenders supplied: the difference is **reserves**, the protocol's own money built up from the gap between borrow and supply interest.

```
reserves = tokenBalance − totalSupply + totalBorrow
```

Comet lets borrowers borrow out of reserves too. Once borrows are larger than supply, utilization is above 100% and the extra debt is funded by reserves.

**Example.** Lenders supplied 1,000 USDC and the market has 1,000 USDC of reserves, so it holds 2,000 USDC. Borrowers can take 1,500 USDC, and utilization is then 1,500 / 1,000 = **150%**.

Above 100%, borrowers pay the steep part of the curve, so this is meant to be a short-lived state. Lenders are unaffected as long as tokens are left in the market to withdraw.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 4. The 200% Cap

### Why it exists

Without a limit, one large borrower on a thin market can push utilization to any level, as long as there are reserves or other lenders' tokens to take. Because the curve has no ceiling, the borrow rate goes up for **everyone**, not only for the account that caused it:

- **Forced liquidations.** Every other borrower's debt suddenly grows many times faster. Positions that were weeks away from liquidation cross the line within hours, and the attacker, or anyone, can liquidate them.
- **Reserve drain.** The borrowing is funded by reserves, the protocol's buffer against bad debt.
- **Illiquidity.** Tokens leave the market, so lenders may not be able to withdraw.

**Example.** Lenders supplied 10,000 USDC and borrowers owe 5,600 USDC, so utilization is 56%. With the example curve above, the borrow APR is **3.8%**. An attacker deposits $100k of collateral and borrows 80,000 USDC from reserves. Utilization jumps to 85,600 / 10,000 = 856%, and the APR becomes 1% + 4% + 30% × 7.76 ≈ **238%**. Every existing borrower's debt now grows about 60× faster.

`MAX_SUPPORTED_UTILIZATION = 2e18` (200%) caps this. A borrow is rejected if it would leave utilization above 200%. This leaves room to borrow from reserves in normal operation (section 3) but rules out the extreme spikes.

### Where it is checked

The cap is checked only on the two actions that create new debt. It is checked after the balances are updated, so it sees the utilization the action would leave behind. Exactly 200% is allowed.

| Action | Check | Revert |
|---|---|---|
| `withdraw` of base that ends with a negative balance | `getUtilization() > 200%` | `ExceedsSupportedUtilization` |
| `transfer` of base that ends with a negative balance on the sender's side | `totalBorrow / (totalSupply − newly credited supply to receiver) > 200%` | `ExceedsSupportedUtilization` |

**Withdraw example.** Supply 1,000, borrows 1,500 (150%).

| Bob borrows | Utilization after | Result |
|---|---|---|
| 500 | 2,000 / 1,000 = 200% | ✓ allowed |
| 600 | 2,100 / 1,000 = 210% | ✗ reverts |

### Why transfer is checked differently

A borrow through `transfer` sends the borrowed amount to another account as supply. That raises `totalSupply`, which makes utilization *look* lower, but the receiver can withdraw it right away as a lender, and lender withdrawals are not capped. So the transfer check leaves out the supply credited to the receiver and asks what utilization would be if they withdrew immediately.

**Example.** Supply 1,000, borrows 1,500. Bob borrows 600 by transferring it to a fresh account, Eve.

| | Supply | Borrow | Utilization |
|---|---|---|---|
| Naive check | 1,000 + 600 = 1,600 | 2,100 | 131% ✓ |
| Actual check (without Eve's 600) | 1,000 | 2,100 | 210% ✗ reverts |

If only the naive check applied, Eve could withdraw the 600 in the next call and leave the market at 210%, getting around the cap.

### What is not capped

The cap is a check on new debt, not a limit on the market's state. Utilization can still go above 200% through:

- **Lender withdrawals and transfers.** Lenders can always take their own money out. A withdrawal lowers supply and raises utilization, but it is never blocked by the cap.
- **Interest.** Borrow interest grows faster than supply interest, so utilization drifts up on its own over time.
- **Liquidation.** `absorb` and `buyCollateral` are not checked. Both lower debt anyway.

When utilization is above 200% for any of these reasons, every new borrow reverts until repayments or new supply bring it back to 200% or below.

> **No supply, no cap.** When the market has no lenders at all, `getUtilization()` returns 0 and the transfer check is skipped. A borrow against reserves then passes the cap even though borrows are larger than supply.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 5. Empty and No-Borrow Markets

### Empty market

With no supply and no borrows, both rates are 0 and neither index moves. Seeding reserves into a new market (sending base tokens directly to it) does not start interest.

### Lenders but no borrowers

At 0% utilization lenders still earn the **supply base rate**. With no borrowers paying interest, that money can only come from reserves. If it were paid indefinitely, lenders' balances would grow past the tokens the market actually holds, and the last lenders to withdraw would find nothing left.

So at 0% utilization, the supply rate is cut to 0 once the lenders' total balance catches up with the market's token balance. It stays 0 until the first borrow brings utilization above 0, and then the normal curve applies again.

**Example.** Lenders supply 2,000,000 USDC to a new market seeded with 5 USDC of reserves. The supply base rate is 0.1% per year.

- Interest owed to lenders: 2,000,000 × 0.1% = 2,000 USDC per year, all paid from reserves.
- The 5 USDC runs out after 5 / 2,000 = 0.0025 years, about **22 hours**.
- From then on the supply rate is 0 and lenders' balances stop growing.
- A borrower takes 2,000 USDC. Utilization is now above 0 and the supply rate follows the curve again.

The cutoff is checked once per accrual, and the rate applies to the whole time since the last accrual. So one long accrual gap can overshoot the balance by a few wei before the rate drops to 0.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 6. Reference

### Views

| Function | Returns |
|---|---|
| `getUtilization()` | Current utilization, `1e18` = 100%. Does not accrue. |
| `getSupplyRate(utilization)` | Per-second supply rate at that utilization |
| `getBorrowRate(utilization)` | Per-second borrow rate at that utilization |
| `getReserves()` | Base reserves, with interest accrued to now |
| `MAX_SUPPORTED_UTILIZATION()` | `2e18` (200%) |

To get an APR from a rate, multiply it by `31,536,000` (seconds per year).

`getSupplyRate` and `getBorrowRate` check the current `totalSupplyBase` and `totalBorrowBase` for the zero-rate cases. So calling them with a made-up utilization still answers for the market's current state.

### Configuration

| Parameter | Meaning |
|---|---|
| `supplyKink`, `borrowKink` | Utilization where the high slope starts, `1e18` = 100% |
| `supplyPerYearInterestRateBase`, `borrowPerYearInterestRateBase` | Rate at 0% utilization |
| `supplyPerYearInterestRateSlopeLow`, `borrowPerYearInterestRateSlopeLow` | Rate added per 100% of utilization, up to the kink |
| `supplyPerYearInterestRateSlopeHigh`, `borrowPerYearInterestRateSlopeHigh` | Rate added per 100% of utilization, after the kink |

### Errors

| Error | Raised when |
|---|---|
| `ExceedsSupportedUtilization()` | A borrow through `withdraw` or `transfer` would leave utilization above 200% |

### Tests

| Area | File |
|---|---|
| Rate curve, over-utilization, 200% cap, lender withdrawals, no-borrow cutoff, forced-liquidation attempt | [`test/interest-rate-test.ts`](../test/interest-rate-test.ts) |
| Indices on an empty market | [`test/accrue-test.ts`](../test/accrue-test.ts) |
| Reserves | [`test/reserves-test.ts`](../test/reserves-test.ts) |

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>
