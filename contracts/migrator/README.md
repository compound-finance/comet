## CToken Migrator

The CToken Migrator is a contract that allows a user to transfer a position from Compound II to Compound III.

### Migration Process

Knobs:

 - CToken balances: Choose how much collateral to migrate (0 = don't migrate, -1 = full balance)
 - Borrow token: Choose which borrow token to migrate (e.g. USDC or DAI)
 - Repay amount: Choose how much to repay (-1 = full balance)
 - Min swap ratio: If borrow token is not USDC, minimum price for swap to USDC (e.g. 0.98)

Contracts:

 - `migrator`: An instance of this CTokenMigrator contract
 - `uniswap`: Uniswap used for flash loans and borrow trades
 
Contract Inputs:

 - `user`: The account initiating the migration
 - `{cToken, amt}[]`: A set of cTokens and relative amounts to be used as collateral
 - `borrowCToken`: The borrowed token position to migrate (e.g. cUSDC or cDAI)
 - `repayAmount`: Amount of borrow to repay, -1 for all.
 - `minSwapRatio` - Minimum ratio to receive in swap (e.g. 0.98 = 98 USDC for each DAI)

Bindings:

- `usdcSwapAmount` - Amount of USDC required to swap for `repayAmount`
- `collateral[]`: An alias of `cToken.underlying()` for all cTokens
- `borrowToken`: Alias for `borrowCToken.underlying()`

Note: this doesn't currently support `CEther`.
Note: each collateral must be supported in v3.
Note: collateral factors or liquidity may cause a migration to fail.
Note: This migrator must already have called full approvals for Comet for all collateral on initialization.

TODO: We need to spend some time thinking about how much to flash loan and how much to borrow from v3

a) The user approves this contract as an operator for v3 `comet.allow(migrator, true)`
b) The user approves this contract to control each v2 cToken `cToken.approve(migrator, amt)`
c) If `repayAmount` == -1, `repayAmount` = `borrowCToken.borrowBalance(user)`
d) USDC: Let `usdcSwapAmount` = `repayAmount`
e) Non-USDC: Let `usdcSwapAmount` = `quotePrice(USDC, borrowToken, repayAmount)`
f) We take out a `USDC` flash loan from Uniswap for `usdcSwapAmount`
g) Non-USDC: Swap `usdcSwapAmount` of `USDC` for `borrowToken` on Uniswap for exactly `repayAmount` (TODO: Exactly??)
h) We repay the user's borrow `borrowCToken.repayBehalf(user, repayAmount)`
e) We transfer to ourselves all of the user's cTokens `cToken.transferFrom(user, amt)` [for each `cToken, amt`]
f) We redeem all cTokens. `cToken.redeem(cToken.balanceOf(migrator))` [for each `cToken, amt`]
g) We supply each underlying on behalf of the user to v3 as collateral. `comet.supplyCollateral(migrator, user, collateral, collateral.balanceOf(migrator))` [for each `collateral`]
h) We borrow USDC from Comet `comet.withdrawBase(user, migrator, usdcSwapAmount)`
i) Repay flash loan for `usdcSwapAmount`
```
