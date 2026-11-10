# Interest Accrual

How interest builds up in a Comet market: the principal-and-index model, when the market accrues, and when indices stop growing: on an empty market, on a market with no borrows, and once lenders have earned all the reserves.

> Reference contract: [`CometWithExtendedAssetList`](../contracts/CometWithExtendedAssetList.sol). How the rates themselves are computed from utilization is covered in [Utilization](utilization.md). Reward tracking indices are out of scope.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Principal and Index](#2-principal-and-index)
3. [When the Market Accrues](#3-when-the-market-accrues)
4. [When Indices Stop Growing](#4-when-indices-stop-growing)
5. [Reference](#5-reference)

---

## 1. Overview

Comet never updates every account's balance when interest accrues. It keeps two market-wide numbers, the **supply index** and the **borrow index**, which grow over time at the current supply and borrow rates. Each account stores a fixed **principal**, and its balance is always `principal × index`.

So one storage write, **accruing the market**, moves interest for every lender and borrower at once.

Interest should only move when someone is actually earning or paying it. The market now follows that strictly:

| Rule | Effect |
|---|---|
| No lenders (`totalSupplyBase == 0`) | Supply rate is 0. The supply index stops. |
| No borrowers (`totalBorrowBase == 0`) | Borrow rate is 0. The borrow index stops. |
| No borrowers, and lenders have already earned every token the market holds | Supply rate is 0. The supply index stops. |

Separately, collateral supply, withdraw and transfer now **accrue first**, like every base action already did. Collateral checks therefore always see the current debt.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 2. Principal and Index

Both indices start at `1e15` (1.0) when the market is created.

An account's base position is one signed **principal**: positive for a lender, negative for a borrower. It is converted to and from a balance with the index of its side:

```
balance   = principal × index
principal = balance / index        (when the position changes)
```

**Example.** Alice supplies 1,000 USDC when the supply index is 1.02. Her principal is 1,000 / 1.02 = **980.39**. A few months later the index is 1.05, and her balance is 980.39 × 1.05 = **1,029.41 USDC**. Her principal never changed; the index carried her interest.

### Accrual

Accruing the market moves each index forward by its rate over the time since the last accrual:

```
index = index × (1 + rate × timeElapsed)
```

`rate` is per second: the yearly configuration value divided by 31,536,000. Within one accrual the growth is linear. Compounding happens across accruals, because each one starts from the index the previous one left. On an active market accruals happen every few blocks, so the result is effectively continuous compounding.

**Example.** A borrow rate of 5% per year:

| Accrued | Borrow index after 1 year |
|---|---|
| Once, after a full year | 1.0 × (1 + 0.05) = **1.0500** |
| Every month | ≈ **1.0512** |

Both rates are read **once per accrual**, from the state the market was in *before* the action that triggered it. An action that changes utilization affects rates only from the next accrual on.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 3. When the Market Accrues

Accrual runs at the start of every action that changes balances, at most once per block (nothing happens when no time has passed):

| Action | Accrues |
|---|---|
| Base supply, withdraw, transfer | ✓ |
| `absorb` | ✓ |
| **Collateral supply** | ✓ **new** |
| **Collateral withdraw** | ✓ **new** |
| **Collateral transfer** | ✓ **new** |
| `accrueAccount(account)` | ✓. Anyone can call it at any time. |

### Why collateral actions accrue now

Collateral withdraw and transfer end with a borrow collateral check, which values the account's debt as `principal × stored borrow index`. Before this change, collateral actions did not accrue. The check then used the index from the last accrual, which **understated the debt** by all the interest since then. The gap between collateralBCF and collateralLCF was relied on to absorb that.

That buffer is not guaranteed anymore: a soft-delisted asset has collateralBCF = 0, and on a quiet market the stale interest can be large. Accruing first removes the question. Every check now sees the debt as of the current block. Collateral supply accrues too, so that **every** user action follows the same rule.

### Views vs checks

Views and checks read the indices differently:

- **Balance views** (`balanceOf`, `borrowBalanceOf`, `totalSupply`, `totalBorrow`) compute the accrued indices on the fly. They show live values without writing anything.
- **Checks** (`isBorrowCollateralized`, `isLiquidatable`, `getUtilization`) use the **stored** indices. Called directly, they reflect the market as of its last accrual. Inside an action they always see current values, because the action accrues first.

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 4. When Indices Stop Growing

### The states

| Market state | Supply rate | Borrow rate | Supply index | Borrow index |
|---|---|---|---|---|
| **Empty**: no lenders, no borrowers | 0 | 0 | stops | stops |
| **Lenders only**, reserves left to pay them | base rate | 0 | grows at the base rate | stops |
| **Lenders only**, reserves used up | 0 | 0 | stops | stops |
| **Lenders and borrowers** | from the curve | from the curve | grows | grows |
| **Borrowers only**: every lender has withdrawn | 0 | base rate | stops | grows at the base rate |

The last row happens because utilization is defined as 0 when there is no supply. The borrow rate then comes from the curve at 0 utilization, which is its base rate.

### Empty market

With no lenders and no borrowers, nobody earns or pays anything, so both indices stay where they are. That includes the time **before the first user**. A new market stays at 1.0 until someone supplies, even if it was seeded with reserves days earlier. Seeding only moves tokens in; it creates no supply or borrow.

The first supply doesn't move the index either. The action accrues **before** it credits the new principal, so that accrual still sees an empty market.

Previously both indices grew at their base rates from the moment the market was created, whether or not anyone was using it.

### No borrowers

Without borrowers the borrow index stops. There is no debt for it to grow. The supply side is different: lenders keep earning the **supply base rate**, and with no borrowers paying interest, that money comes from reserves.

So there is a limit. Once lenders' total balance reaches the tokens the market actually holds, the supply rate drops to 0 and the supply index stops. It starts again as soon as the first borrow brings utilization above 0. This keeps lenders from being owed more than the market can pay out. [Utilization §5](utilization.md#5-empty-and-no-borrow-markets) has a worked example.

This cutoff replaces an older fix that clamped the supply index back down *after* it had grown too far. Now the rate is cut before the index moves. The cutoff is checked once per accrual, and the rate applies to the whole time since the last one, so a single long gap can overshoot by a few wei before the rate reaches 0.

### Why stopping matters

An index is a record of interest that positions actually earned or paid. When it grows with no positions behind it, the index drifts away from anything real. Every later user then starts from a number that includes interest nobody paid. Stopping it keeps the rule simple: **an index moves only while someone is on its side of the market, and only by what is actually paid.**

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>

---

## 5. Reference

### Storage and views

| Name | Returns |
|---|---|
| `totalsBasic()` | Stored `baseSupplyIndex`, `baseBorrowIndex`, `lastAccrualTime`, `totalSupplyBase`, `totalBorrowBase` |
| `getSupplyRate(utilization)` / `getBorrowRate(utilization)` | Per-second rates. Include the zero-rate rules above, based on the market's current totals. |
| `balanceOf` / `borrowBalanceOf` | Live balance of an account, with interest to now |
| `totalSupply()` / `totalBorrow()` | Live market totals, with interest to now |
| `accrueAccount(account)` | Accrues the market. Callable by anyone. |

### Constants

| Constant | Value |
|---|---|
| `BASE_INDEX_SCALE` | `1e15` (index 1.0) |
| `SECONDS_PER_YEAR` | `31,536,000` |

### Tests

| Area | File |
|---|---|
| Indices on an empty market, after seeding, after the first supply and with no borrows | [`test/accrue-test.ts`](../test/accrue-test.ts) |
| Rates and indices across market states, no-borrow cutoff | [`test/interest-rate-test.ts`](../test/interest-rate-test.ts) |
| Accrual before collateral supply, withdraw and transfer | [`test/supply-test.ts`](../test/supply-test.ts), [`test/withdraw-test.ts`](../test/withdraw-test.ts), [`test/transfer-test.ts`](../test/transfer-test.ts) |

<div align="right"><a href="#table-of-contents">⬆ Back to Table of Contents</a></div>
