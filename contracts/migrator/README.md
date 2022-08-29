# CToken Migrator

The CToken Migrator is a set of contracts to transfer a positions from Compound II to Compound III.

# Migration Spec Compound_Migrate_V2_USDC_to_V3_USDC

The Compound_Migrate_V2_USDC_to_V3_USDC contract is used to transfer a position where a user is borrowing USDC from Compound II to a position where that user is now borrowing USDC in Compound III. We use a flash loan to faciliate the transition, but there are no swaps otherwise involved in this transfer. Positions can be transferred in whole or in part.

## Knobs

Users can specify the following parameters, generally:

 - Collateral to transfer: A user may choose how much collateral to transfer, e.g. all of my UNI and part of my COMP.
 - Amount to repay: The user may choose how much to repay of USDC (e.g. all of it or 2000 USDC).

## Contract Storage

 * `comet: Comet` **immutable**: The Comet Ethereum mainnet USDC contract.
 * `uniswapLiquidityPool: UniswapPool` **immutable**: The Uniswap pool used by this contract to source liquidity (i.e. flash loans).
 * `uniswapLiquidityPoolToken0: boolean` **immutable**: True if borrow token is token 0 in the Uniswap liquidity pool, otherwise false if token 1.
 * `uniswapLiquidityPoolFee: uint256` **immutable**: Fee for a flash loan from the liquidity pool as a fixed decimal (e.g. `0.001e18 = 0.1%`)
 * `collateralTokens: Erc20[]`: A list of valid collateral tokens
 * `borrowCToken: CToken` **immutable**: The Compound II market for the borrowed token (e.g. `cUSDC`).
 * `borrowToken: Erc20` **immutable**: The underlying borrow token (e.g. `USDC`).
 * `sweepee: address` **immutable**: Address of an address to send swept tokens to, if for any reason they remain locked in this contract.

## Structs

### Collateral

Represents a given amount of collateral to migrate.

```c
struct Collateral {
  CToken cToken,
  uint256 amount
}
```

### UniswapCallback

Represents all data required to continue operation after a flash loan is initiated.

```c
struct MigrationCallbackData {
  address user,
  uint256 repayAmountActual,
  uint256 repayBorrowBehalf,
  Collateral[] collateral
}
```

## Events

TODO

## Inherits

 * `PeripheryPayments` - https://github.com/Uniswap/v3-periphery/blob/main/contracts/base/PeripheryPayments.sol

## Contract Functions

### Constructor

This function describes the initialization process for this contract. We set the Compound III contract address and track valid collateral tokens.

#### Inputs

 * `comet_: Comet`: The Comet Ethereum mainnet USDC contract.
 * `uniswapLiquidityPool_: IUniswapV3Pool` : The Uniswap pool used by this contract to source liquidity (i.e. flash loans).
 * `collateralTokens_: Erc20[]`: A list of valid collateral tokens
 * `borrowCToken`: The Compound II market for the borrowed token (e.g. `cUSDC`).

#### Function Spec

`function Compound_Migrate_V2_USDC_to_V3_USDC(Comet comet_, CToken borrowCToken_, UniswapPool uniswapLiquidityPool_, Erc20[] collateralTokens_, address sweepee_)`

 * **WRITE IMMUTABLE** `comet = comet_`
 * **WRITE IMMUTABLE** `borrowCToken = borrowCToken_`
 * **WRITE IMMUTABLE** `borrowToken = borrowCToken_.underlying()`
 * **WRITE IMMUTABLE** `uniswapLiquidityPool = uniswapLiquidityPool_`
 * **WRITE IMMUTABLE** `uniswapLiquidityPoolFee = uniswapLiquidityPool.fee()`
 * **WRITE IMMUTABLE** `uniswapLiquidityPoolToken0 = uniswapLiquidityPool.token0() == borrowToken`
 * **WRITE IMMUTABLE** `sweepee = sweepee_`
 * **FOREACH** `collateralToken` in `collateralTokens_`
   * **WRITE** `colllateralTokens.push(collateralToken)`

### Migrate Function

This is the core function of this contract, migrating a position from Compound II to Compound III. We use a flash loan from Uniswap to provide liquidity to move the position.

**N.B.** Collateral requirements may be different in Compound II and Compound III. This may lead to a migration failing or being less collateralized after the migration. There are fees associated with the flash loan, which may affect position or cause migration to fail.

#### Pre-conditions

Before calling this function, a user is required to:

 - a) Call `comet.allow(migrator, true)`
 - b) For each `{collateralCToken, amount}` in `collateral`, call `collateralCToken.approve(migrator, amount)`.

Notes for (b):

 - allowance may be greater than `amount`, such as max uint256, but may not be less.
 - allowances are in native cToken, not underlying amounts.

#### Inputs

 * `collateral: Collateral[]` - Array of collateral to transfer into Compound III. See notes below.
 * `borrowAmount: uint256` - Amount of borrow to migrate (i.e. close in Compound II, and borrow from Compound III). See notes below.

Notes:
 - Each `collateral` market must exist in `collateralTokens` array, defined on contract creation.
 - Each `collateral` market must be supported in Compound III.
 - `collateral` amounts of 0 are strictly ignored. Collateral amounts of max uint256 are set to the user's current balance.
 - `borrowAmount` may be set to max uint256 to migrate the entire current borrow balance.

#### Bindings

 * `user: address`: Alias for `msg.sender`
 * `underlyings[]: Erc20[]`: Alias for `cToken.underlying()` for collateral tokens.
 * `repayAmountActual: uint256`: The repay amount, after accounting for max.
 * `borrowAmountTotal: uint256`: The amount to borrow from Compound III, accounting for fees.
 * `data: bytes[]`: The ABI-encoding of the `MigrationCallbackData`, to be passed to the Uniswap Liquidity Pool Callback.

#### Function Spec

`function migrate(collateral: (CToken, uint256)[], borrowAmount: uint256) external`

- **REQUIRE** `inMigration == 0`
- **STORE** `inMigration += 1`
- **BIND** `user = msg.sender`
- **WHEN** `repayAmount == type(uint256).max)`:
  - **BIND READ** `repayAmountActual = cToken.borrowBalanceCurrent(user)`
- **ELSE**
  - **BIND** `repayAmountActual = repayAmount`
- **BIND** `borrowAmountTotal = repayAmountActual + FullMath.mulDivRoundingUp(repayAmountActual, uniswapLiquidityPoolFee, 1e6)` # TODO: FullMath
- **BIND** `data = abi.encode(MigrationCallbackData{user, repayAmountActual, repayBorrowBehalf, collateral})`
- **CALL** `uniswapLiquidityPool.flash(address(this), uniswapLiquidityPoolToken0 ? repayAmount : 0, uniswapLiquidityPoolToken0 ? 0 : repayAmount, data)`
- **STORE** `inMigration -= 1`

Note: for fee calculation see [UniswapV3Pool](https://github.com/Uniswap/v3-core/blob/main/contracts/UniswapV3Pool.sol#L800).

### Uniswap Liquidity Pool Callback Function

This function handles a callback from the Uniswap Liquidity Pool after it has sent this contract the requested tokens. We are responsible for repaying those tokens, with a fee, before we return from this function call.

#### Pre-conditions

This function may only be called during a migration command. We ensure this by making sure this function, itself, is the caller of the `swap` command. We check that the call originates from the expected Uniswap pool, and we check that we are actively processing a migration. This combination of events should ensure that no external party can trigger this code, though it's not clear it would be dangerous even if such a party did.

#### Inputs

 - `uint fee0`: The fee for borrowing token0 from pool. Ignored.
 - `uint fee1`: The fee for borrowing token1 from pool. Ignored.
 - `calldata data`: The data encoded above, which is the ABI-encoding of `MigrationCallbackData`.

#### Bindings

 * `repayAmountActual`: The repay amount, after accounting for max.

#### Function Spec

`function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data)`

  - **REQUIRE** `inMigration == 1`
  - **REQUIRE** `msg.sender == uniswapLiquidityPool`
  - **REQUIRE** `sender == address(this)`
  - **BIND** `MigrationCallbackData{user, repayAmountActual, borrowAmountTotal, collateral} = abi.decode(data, (MigrationCallbackData))`
  - **CALL** `borrowCToken.repayBorrowBehalf(user, repayAmountActual)`
  - **FOREACH** `(cToken, amount)` in `collateral`:
    - **CALL** `cToken.transferFrom(user, amount == type(uint256).max ? cToken.balanceOf(user) : amount)`
    - **CALL** `cToken.redeem(cToken.balanceOf(address(this)))`
    - **CALL** `comet.supplyCollateral(address(this), user, cToken.underlying(), cToken.underlying().balanceOf(address(this)))`
  - **CALL** `comet.withdrawBase(user, address(this), borrowAmountTotal)`
  - **CALL** `pay(borrowToken, address(this), msg.sender, borrowAmountTotal)`

### Sweep Function

Sends any tokens in this contract to the sweepee address. This contract should never hold tokens, so this is just to fix any anomalistic situations where tokens end up locked in the contract.

#### Inputs

 - `token: Erc20`: The token to sweep, or zero to sweep Ether

#### Function Spec

`function sweep(Erc20 token)`

  - **REQUIRE** `inMigration == 0`
  - **WHEN** `token == 0x0000000000000000000000000000000000000000`:
    - **EXEC** `sweepee.send(address(this).balance)`
  - **ELSE**
    - **CALL** `token.transfer(sweepee, token.balanceOf(address(this)))`
