# Compound III

## Introduction

Compound III is an EVM compatible protcol that enables supplying of crypto assets as collateral in order to borrow the *base asset*. Accounts can also earn interest by supplying the base asset to the protocol.

The initial deployment of Compound III is on Ethereum and the base asset is USDC.

The [app.compound.finance](https://app.compound.finance) interface is [open-source](https://github.com/compound-finance/palisade), deployed to IPFS, and is maintained by the community.

Please join the #development room in the Compound community [Discord](https://compound.finance/discord) server as well as the forums at [comp.xyz](https://comp.xyz); Compound Labs and members of the community look forward to helping you build an application on top of Compound III. Your questions help us improve, so please don't hesitate to ask if you can't find what you are looking for here.

For documentation of the Compound v2 Protocol, see [compound.finance/docs](https://compound.finance/docs).

## Interest Rates

Compound III supply and borrow interest rates are bound by separate curves. The current interest rates are single points on those curves.

Each curve has a utilization "kink" that affects the resulting rate calculation. All of the variables referenced in the formulas are set exclusively by Compound Governance.

Accounts can earn interest by supplying the base asset. All other supported assets that can be supplied serve as collateral for borrowing and do not earn interest.

Owed interest accrues to open borrows of the base asset. Borrower interest accrues to accounts every second by using the block timestamp. In order to repay an open borrow and free up collateral for withdrawal, an account must supply the base asset that is owed to the protocol.

### Get Supply Rate

This method returns the current supply rate APR as the decimal representation of a percentage scaled up by `10 ^ 18`. The formula for producing the supply rate is:

```
## If the Utilization is currently less than or equal to the Kink parameter

SupplyRate = (InterestRateBase + InterestRateSlopeLow * Utilization) * Utilization * (1 - ReserveRate)

## Else

SupplyRate = (InterestRateBase + InterestRateSlopeLow * Kink + InterestRateSlopeHigh * (Utilization - Kink)) * Utilization * (1 - ReserveRate)
```

#### Comet

```solidity
function getSupplyRate() returns (uint)
```

* `RETURNS`: The current APR as the decimal representation of a percentage scaled up by `10 ^ 18`. E.g. `250000000000000000` indicates a 25% APR.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint supplyRate = comet.getSupplyRate(); // example: 250000000000000000 (25%)
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const supplyRate = await comet.methods.getSupplyRate().call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const supplyRate = await comet.callStatic.getSupplyRate();
```

### Get Borrow Rate

This method returns the current borrow rate APR as the decimal representation of a percentage scaled up by `10 ^ 18`. The formula for producing the borrow rate is:

```
## If the Utilization is currently less than or equal to the Kink parameter

BorrowRate = InterestRateBase + InterestRateSlopeLow * Utilization

## Else

BorrowRate = InterestRateBase + InterestRateSlopeLow * Kink + InterestRateSlopeHigh * (Utilization - Kink)
```

#### Comet

```solidity
function getBorrowRate() returns (uint)
```

* `RETURNS`: The current APR as the decimal representation of a percentage scaled up by `10 ^ 18`. E.g. `90000000000000000` indicates a 9% APR.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint borrowRate = comet.getBorrowRate(); // example: 9000000000000000000 (9%)
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const borrowRate = await comet.methods.getBorrowRate().call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const borrowRate = await comet.callStatic.getBorrowRate();
```

## Collateral & Borrowing

Compound III accounts can supply crypto assets as collateral in order to borrow the base asset. Limits on borrowing are bound by the borrow collateral factors.

The borrow collateral factors are percentages which represent the USD value of a supplied collateral that can be borrowed in the base asset. If the borrow collateral factor for WBTC is 85%, an account can borrow up to 85% of the USD value of its supplied WBTC in the base asset. Collateral factors can be fetched using the *[Get Asset Info](#get-asset-info)* function.

If a borrowing account subsequently no longer meets the borrow collateral factor requirements, it cannot increase the size of its borrow. An account can restore its ability to increase its borrow by repaying the borrow or supplying more collateral.

Account *balances* for the base token are signed integers. An account balance greater than zero indicates the base asset is supplied and a balance less than zero indicates the base asset is borrowed.

Global *indices* for supply and borrow are unsigned integers that increase over time. When an account interacts with the protocol, the indices are saved. An account's present balance can be calculated using the current index with the following formulas that implement the indices.

```
Balance=PrincipalBaseSupplyIndexNow [Principal0]
Balance=PrincipalBaseBorrowIndexNow [Principal<0]
```

### Supply

The supply function transfers an asset to the protocol and adds it to the account's balance. This method can be used to **supply collateral, supply the base asset, or repay an open borrow** of the base asset.

If the base asset is supplied resulting in the account having a balance greater than zero, the base asset earns interest based on the current supply rate. Collateral assets that are supplied do not earn interest.

There are three separate methods to supply an asset to Compound III. The first is on behalf of the caller, the second is to a separate account, and the third is for a manager on behalf of an account.

Before supplying an asset to Compound III, the caller must first execute the asset's ERC-20 approve of the Comet contract.

#### Comet

```solidity
function supply(address asset, uint amount)
```

```solidity
function supplyTo(address dst, address asset, uint amount)
```

```solidity
function supplyFrom(address from, address dst, address asset, uint amount)
```

* `asset`: The address of the asset's smart contract.
* `amount`: The amount of the asset to supply to Compound III expressed as an integer.
* `dst`: The address that is credited with the supplied asset within the protocol.
* `from`: The address to supply from. This account must first use the Allow method in order to allow the sender to transfer its tokens prior to calling Supply.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
comet.supply(0xERC20Address, 1000000);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.supply(usdcAddress, 1000000).send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.supply(usdcAddress, 1000000);
```

### Withdraw

The withdraw method is used to **withdraw collateral** that is not currently supporting an open borrow. Withdraw is **also used to borrow the base asset** from the protocol if there is sufficient collateral for the account. It can also be called from an allowed manager address. To check an account's present ability to increase its borrow size, see the *[Get Borrow Liquidity](#get-borrow-liquidity)* function.

#### Comet

```solidity
function withdraw(address asset, uint amount)
```

```solidity
function withdrawTo(address to, address asset, uint amount)
```

```solidity
function withdrawFrom(address src, address to, address asset, uint amount)
```

* `asset`: The address of the asset that is being withdrawn or borrowed in the transaction.
* `amount`: The amount of the asset to withdraw or borrow.
* `to`: The address to send the withdrawn or borrowed asset.
* `src`: The address of the account to withdraw or borrow on behalf of. The `withdrawFrom` method can only be called by an allowed manager.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
comet.withdraw(0xwbtcAddress, 100000000);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.withdraw(usdcAddress, 100000000).send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.withdraw(usdcAddress, 100000000);
```

### Get Borrow Liquidity

This function returns the amount of base asset in USD that is presently borrowable by an account as an integer scaled up by `10 ^ 8`. If the returned value is negative, the account is not allowed to borrow any more from the protocol until more collateral is supplied or there is repayment such that the account's borrow liquidity becomes positive. A negative borrow liquidity does not necessarily imply that the account is presently liquidatable (see *[isLiquidatable](#liquidatable-accounts)* function).

#### Comet

```solidity
function getBorrowLiquidity(address account) returns (int256)
```

* `account`: The account to examine borrow liquidity.
* `RETURNS`: Returns the current borrow liquidity of the account in USD as an integer scaled up by `10 ^ 8`.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
int borrowLiquidity = comet.getBorrowLiquidity(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const borrowLiquidity = await comet.methods.getBorrowLiquidity('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const borrowLiquidity = await comet.callStatic.getBorrowLiquidity('0xAccount');
```

### Borrow Collateralization

This function returns true if the account passed to it has non-negative liquidity based on the borrow collateral factors. This function returns false if an account does not have sufficient liquidity to increase its borrow position. A return value of false does not necessarily imply that the account is presently liquidatable (see *[isLiquidatable](#liquidatable-accounts)* function).

#### Comet

```solidity
function isBorrowCollateralized(address account) returns (bool)
```

* `account`: The account to examine collateralization.
* `RETURNS`: Returns true if the account has enough liquidity for borrowing.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
bool isCollateralized = comet.isBorrowCollateralized(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const isCollateralized = await comet.methods.isBorrowCollateralized('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const isCollateralized = await comet.callStatic.isBorrowCollateralized('0xAccount');
```

## Liquidation

Compound III borrowers need to consider the *borrow collateral factors* and the *liquidation collateral factors* in order to keep their account healthy and avoid liquidation.

The liquidation collateral factors are strictly greater than the borrow collateral factors. If a borrower violates the liquidation collateral factor requirements, their account is subject to liquidation. Examples of instances where this occurs are described below.

Collateral factors are stored as integers that represent decimal values scaled up by `10 ^ 18` in the Comet smart contract. For example, a value of `950000000000000000` represents a 95% collateral factor. Borrow and liquidation collateral factors can be fetched using the *[Get Asset Info](#get-asset-info)* function.

An account is subject to liquidation if its borrowed amount exceeds the limits set by the liquidation collateral factors. The three instances where this can occur are when borrower interest owed accrues beyond the limit, when the USD value of the collateral drops below supporting the open borrow, or when the USD value of the borrowed asset increases too much. If an underwater account violates the borrow collateral factors, but does not violate the liquidation collateral factors, it is not yet subject to liquidation.

Liquidation is the absorption of an underwater account into the protocol, triggered by the *[absorb](#absorb)* function. The protocol seizes all of the account's collateral and repays its open borrow. The protocol can then attempt to sell some or all of the collateral to recover any reserves that covered liquidation. If any excess collateral is seized, the protocol will pay the excess back to the account in the base asset.

### Account Liquidation Margin

This function returns the USD value of liquidity available before the specified account becomes liquidatable. If the returned integer is less than zero, the account is presently liquidatable.

#### Comet

```solidity
function getLiquidationMargin(address account) public view returns (int)
```

* `account`: The account to examine liquidity available.
* `RETURNS`: Returns an integer of the current liquidity available to the account in USD as an integer scaled up by `10 ^ 8`.


#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
int liquidity = comet.getLiquidationMargin(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const liquidity = await comet.methods.getLiquidationMargin('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const liquidity = await comet.callStatic.getLiquidationMargin('0xAccount');
```

### Liquidatable Accounts

This function returns true if the account passed to it has negative liquidity based on the liquidation collateral factor. A return value of true indicates that the account is presently liquidatable.

#### Comet

```solidity
function isLiquidatable(address account) returns (bool)
```

* `account`: The account to examine liquidatability.
* `RETURNS`: Returns true if the account is presently able to be liquidated.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
bool isLiquidatable = comet.isLiquidatable(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const isLiquidatable = await comet.methods.isLiquidatable('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const isLiquidatable = await comet.callStatic.isLiquidatable('0xAccount');
```

### Absorb

This function can be called by any address to liquidate an underwater account. It transfers the account's debt to the protocol account, decreases cash reserves to repay the account's borrows, and adds the collateral to the protocol's own balance. The caller has the amount of gas spent noted. In the future, they could be compensated via governance.

#### Comet

```solidity
function absorb(address absorber, address[] calldata accounts)
```

* `absorber`:  The account that is issued the liquidator points on successful execution.
* `accounts`:  An array of underwater accounts that are to be liquidated.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
comet.absorb(0xMyAddress, [ 0xUnderwaterAddress ]);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.absorb('0xMyAddress', [ '0xUnderwaterAddress' ]).send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.absorb('0xMyAddress', [ '0xUnderwaterAddress' ]);
```

### Buy Collateral

This function allows any account to buy collateral from the protocol, at a discount from the Price Feed's price, using base tokens. A minimum collateral amount should be specified to indicate the maximum slippage acceptable for the buyer.

This function can be used after an account has been liquidated and there is collateral available to be purchased. Doing so increases protocol reserves. The amount of collateral available can be found by calling the *[Collateral Balance](#collateral-balance)* function. The price of the collateral can be determined by using the *[quoteCollateral](#ask-price)* function.

#### Comet

```solidity
function buyCollateral(address asset, uint minAmount, uint baseAmount, address recipient) external
```

* `asset`: The address of the collateral asset.
* `minAmount`: The minimum amount of collateral tokens that are to be received by the buyer, scaled up by 10 to the "decimals" integer in the collateral asset's contract.
* `baseAmount`: The amount of base tokens used to buy collateral scaled up by 10 to the "decimals" integer in the base asset's contract.
* `recipient`: The address that receives the purchased collateral.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
comet.buyCollateral(0xAssetAddress, 5e18, 5e18, 0xRecipient);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.buyCollateral('0xAssetAddress', 5e18, 5e18, '0xRecipient').send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.buyCollateral('0xAssetAddress', 5e18, 5e18, '0xRecipient');
```

## Reserves

Reserves are a portion of historical interest set aside as cash which can be withdrawn or transferred through the protocol's governance. A portion of borrower interest accrues into the protocol, determined by the reserve factor. The Compound III account [liquidation](#liquidation) process uses and also adds to protocol reserves.

There is an immutable value in the Comet contract that represents a target reserve value. Once the contract has reached the level of target reserves, liquidators are not able to buy collateral from the protocol.

### Get Reserves

This function returns the amount of protocol reserves for the base asset as an integer.

#### Comet

```solidity
function getReserves() returns (uint)
```

* `RETURNS`: The amount of base asset stored as reserves in the protocol as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint reserves = comet.getReserves();
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const reserves = await comet.methods.getReserves().call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const reserves = await comet.callStatic.getReserves();
```

### Target Reserves

This immutable value represents the target amount of reserves of the base token. If the protocol holds greater than or equal to this amount of reserves, the *[buyCollateral](#buy-collateral)* function can no longer be successfully called.

#### Comet

```solidity
function targetReserves() returns (uint)
```

* `RETURN`: The target reserve value of the base asset as an integer, scaled up by 10 to the "decimals" integer in the base asset's contract.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint targetReserves = comet.targetReserves();
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const targetReserves = await comet.methods.targetReserves().call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const targetReserves = await comet.callStatic.targetReserves();
```

### Ask Price

In order to repay the borrows of absorbed accounts, the protocol needs to sell the seized collateral. The *Ask Price* is the price of the asset to be sold with a fixed discount (configured by governance). This function uses the price returned by the protocol's price feed.

#### Comet

```solidity
function quoteCollateral(address asset, uint amount) returns (uint)
```

* `address`:  The address of the asset which is being queried.
* `amount`:  The amount of the asset to be sold.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint askPrice = comet.quoteCollateral(0xERC20Address, 10000000000);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const askPrice = await comet.methods.quoteCollateral('0xERC20Address', 1000000).call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const askPrice = await comet.callStatic.quoteCollateral('0xERC20Address', 1000000);
```

### Liquidator Points

The protocol keeps track of the successful executions of absorb by tallying liquidator "points" and gas the liquidator has spent.

#### Comet

```solidity
mapping(address => LiquidatorPoints) public liquidatorPoints;
```

* `address`:  The address of the liquidator account.
* `RETURN`: A struct containing the stored data pertaining to the liquidator account.
* `numAbsorbs`: A Solidity `uint32` of the number of times absorb was successfully called.
* `numAbsorbed`: A Solidity `uint64` of the number of accounts successfully absorbed by the protocol as a result of the liquidators call to the absorb function.
* `approxSpend`: A Solidity `uint128` of the sum of all gas spent by the liquidator that has called the absorb function.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
LiquidatorPoints pointsData = comet.liquidatorPoints(0xLiquidatorAddress);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const [ numAbsorbs, numAbsorbed, approxSpend ] = await comet.methods.liquidatorPoints('0xLiquidatorAddress').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ numAbsorbs, numAbsorbed, approxSpend ] = await comet.callStatic.liquidatorPoints('0xLiquidatorAddress');
```

## Protocol Rewards

Compound III has a built-in system for tracking rewards for accounts that use the protocol. The full history of accrual of rewards are tracked for suppliers and borrowers of the base asset. The rewards can be any ERC-20 token.

### Reward Accrual

The reward accrual is tracked in the Comet contract and rewards can be claimed by users from an external Comet Rewards contract. Rewards are accounted for with up to 6 decimals of precision.

#### Comet

```solidity
function baseTrackingAccrued(address account) external view returns (uint64);
```

* `RETURNS`: Returns the amount of reward token accrued based on usage of the base asset within the protocol for the specified account, scaled up by `10 ^ 6`.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint64 accrued = comet.baseTrackingAccrued(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const accrued = await comet.methods.baseTrackingAccrued('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const accrued = await comet.callStatic.baseTrackingAccrued('0xAccount');
```

### Claim Rewards

Any account can claim rewards for a specific account. Account owners and managers can also claim rewards to a specific address. The claim functions are available on the external Comet Rewards contract.

#### Comet Rewards

```solidity
function claim(address comet, address src, bool shouldAccrue) external
```

```solidity
function claimTo(address comet, address src, address to, bool shouldAccrue) external
```

* `comet`: The address of the Comet contract.
* `src`: The account in which to claim rewards.
* `to`: The account in which to transfer the claimed rewards.
* `shouldAccrue`: If true, the protocol will account for the rewards owed to the account as of the current block before transferring.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
CometRewards rewards = CometRewards(0xRewardsAddress);
rewards.claim(0xCometAddress, 0xAccount, true);
```

#### Web3.js v1.5.x

```js
const rewards = new web3.eth.Contract(abiJson, contractAddress);
await rewards.methods.claim(cometAddress, accountAddress, true).send();
```

#### Ethers.js v5.x

```js
const rewards = new ethers.Contract(contractAddress, abiJson, provider);
await rewards.claim(cometAddress, accountAddress, true);
```

## Account Management

In addition to self-management, Compound III accounts can enable other addresses to have write permissions for their account. Account managers can withdraw or transfer collateral within the protocol on behalf of another account. This is possible only after an account has enabled permissions by using the *[allow](#allow)* function.

### Allow

Allow or disallow another address to withdraw or transfer on behalf of the sender's address.

#### Comet

```solidity
function allow(address manager, bool isAllowed)
```

* `msg.sender`: The address of an account to allow or disallow a manager for.
* `manager`: The address of an account that becomes or will no longer be the manager of the owner.
* `isAllowed`: True to add the manager and false to remove the manager.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
comet.allow(0xmanager, true);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.allow(managerAddress, false).send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.allow(managerAddress, true);
```

### Allow By Signature

This is a separate version of the allow function that enables submission using an EIP-712 offline signature. For more details on how to create an offline signature, review [EIP-712](https://eips.ethereum.org/EIPS/eip-712).

#### Comet

```solidity
function allowBySig(
  address owner,
  address manager,
  bool isAllowed_,
  uint256 nonce,
  uint256 expiry,
  uint8 v,
  bytes32 r,
  bytes32 s
) external
```

* `owner`: The address of an account to allow or disallow a manager for. The signatory must be the owner address.
* `manager`: The address of an account that becomes or will no longer be the manager of the owner.
* `isAllowed`: True to add the manager and false to remove the manager.
* `nonce`: The contract state required to match the signature. This can be retrieved from the contract's public `userNonce` mapping.
* `expiry`: The time at which to expire the signature. A block timestamp as seconds since the unix epoch (uint).
* `v`: The recovery byte of the signature.
* `r`: Half of the ECDSA signature pair.
* `s`: Half of the ECDSA signature pair.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
comet.allowBySig(0xowner, 0xmanager, true, nonce, expiry, v, r, s);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.allowBySig('0xowner', '0xmanager', true, nonce, expiry, v, r, s).send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.allowBySig('0xowner', '0xmanager', true, nonce, expiry, v, r, s);
```

### Account Permissions

This method returns a boolean that indicates the status of an account's management address.

#### Comet

```solidity
function hasPermission(address owner, address manager) public view returns (bool)
```

* `owner`: The address of an account that can be managed by another.
* `manager`: The address of the account that can have manager permissions over another.
* `RETURNS`: Returns true if the `manager` address is presently a manager of the `owner` address.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
bool isManager = comet.hasPermission(0xOwner, 0xManager);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const isManager = await comet.methods.hasPermission('0xOwner', '0xManager').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const isManager = await comet.callStatic.hasPermission('0xOwner', '0xManager');
```

### Transfer

This method is used to transfer an asset within the protocol to another address. A manager of an account is also able to perform a transfer on behalf of the account. Account balances change but the asset does not leave the protocol contract. The transfer will fail if it would make the account liquidatable.

#### Comet

```solidity
function transferCollateral(address dst, address asset, uint amount)
function transferCollateralFrom(address src, address dst, address asset, uint amount)
```

* `dst`: The address of an account that is the receiver in the transaction.
* `src`: The address of an account that is the sender of the asset in the transaction. This transfer method can only be called by an allowed manager.
* `asset`: The ERC-20 address of the asset that is being sent in the transaction.
* `amount`: The amount of the asset to transfer.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
comet.transfer(0xreceiver, 0xwbtcAddress, 100000000);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.transfer(receiverAddress, usdcAddress, 100000000).send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.transfer(receiverAddress, usdcAddress, 100000000);
```

### Interfaces & ERC-20 Compatibility

The Comet contract is a fully compatible ERC-20 wrapper for the base token. All of the interface methods of ERC-20 are externally exposed for accounts that supply or borrow. The **CometInterface.sol** contract file contains an example of a Solidity interface for the Comet contract.

## Helper Functions

### Get Utilization

This method returns the current protocol utilization of the base asset. The formula for producing the utilization is:

`Utilization = TotalBorrows / TotalSupply`

#### Comet

```solidity
function getUtilization() returns (uint)
```

* `RETURNS`: The current protocol utilization percentage as a decimal, represented by an unsigned integer, scaled up by `10 ^ 18`. E.g. `1e17 or 100000000000000000` is 10% utilization.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint utilization = comet.getUtilization(); // example: 10000000000000000 (1%)
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const utilization = await comet.methods.getUtilization().call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const utilization = await comet.callStatic.getUtilization();
```

### Total Collateral

The protocol tracks the current amount of collateral that all accounts have supplied. Each valid collateral asset sum is tracked in a mapping with the asset address that points to a struct.

#### Comet

```solidity
mapping(address => TotalsCollateral) public totalsCollateral;
```

* `address`:  The address of the collateral asset's contract.
* `RETURN`: A struct containing the stored data pertaining to the sum of the collateral in the protocol.
* `totalSupplyAsset`: A Solidity `uint128` of the sum of the collateral asset stored in the protocol, scaled up by 10 to the "decimals" integer in the asset's contract.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
TotalsCollateral totalsCollateral = comet.totalsCollateral(0xERC20Address);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const [ totalSupplyAsset ] = await comet.methods.totalsCollateral('0xERC20Address').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ totalSupplyAsset ] = await comet.callStatic.totalsCollateral('0xERC20Address');
```

### Collateral Balance

This method returns the current balance of a collateral asset for a specified account in the protocol.

#### Comet

```solidity
function collateralBalanceOf(address account, address asset) returns (uint128)
```

* `account`: The address of the account in which to retrieve a collateral balance.
* `asset`: The address of the collateral asset smart contract.
* `RETURNS`: The balance of the collateral asset in the protocol for the specified account as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint balance = comet.collateralBalanceOf(0xAccount, 0xUsdcAddress);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const balance = await comet.methods.collateralBalanceOf('0xAccount', '0xUsdcAddress').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const balance = await comet.callStatic.collateralBalanceOf('0xAccount', '0xUsdcAddress');
```

### Supplied Base Balance

This method returns the current balance of base asset for a specified account in the protocol, including interest. If the account is presently borrowing or not supplying, it will return `0`.

#### Comet

```solidity
function balanceOf(address account) returns (uint256)
```

* `account`: The address of the account in which to retrieve the base asset balance.
* `RETURNS`: The balance of the base asset, including interest, in the protocol for the specified account as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint balance = comet.balanceOf(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const balance = await comet.methods.balanceOf('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const balance = await comet.callStatic.balanceOf('0xAccount');
```

### Borrow Balance

This method returns the current balance of borrowed base asset for a specified account in the protocol, including interest. If the account has a non-negative base asset balance, it will return `0`.

#### Comet

```solidity
function borrowBalanceOf(address account) returns (uint256)
```

* `account`: The address of the account in which to retrieve the borrowed base asset balance.
* `RETURNS`: The balance of the base asset, including interest, borrowed by the specified account as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint owed = comet.borrowBalanceOf(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const owed = await comet.methods.borrowBalanceOf('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const owed = await comet.callStatic.borrowBalanceOf('0xAccount');
```

### Base Balance as Integer

This method returns the current balance of base asset for a specified account in the protocol, including interest. If the account is currently borrowing, the return value will be negative. If the account is currently supplying the base asset, the return value will be positive.

#### Comet

```solidity
function baseBalanceOf(address account) returns (int104)
```

* `account`: The address of the account in which to retrieve the base asset balance.
* `RETURNS`: The balance of the base asset, including interest, that the specified account is due as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint baseBalance = comet.baseBalanceOf(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const baseBalance = await comet.methods.baseBalanceOf('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const baseBalance = await comet.callStatic.baseBalanceOf('0xAccount');
```

### Account Data

The protocol tracks data like the principal and indexes for each account that supplies and borrows. The data is stored in a mapping with the account address that points to a struct.

#### Comet

```solidity
struct UserBasic {
    int104 principal;
    uint64 baseTrackingIndex;
    uint64 baseTrackingAccrued;
    uint16 assetsIn;
}

mapping(address => UserBasic) public userBasic;
```

* `address`:  The address of the account that has used the protocol.
* `RETURN`: A struct containing the stored data pertaining to the account.
* `principal`: A Solidity `int104` of the amount of base asset that the account has supplied (greater than zero) or owes (less than zero) to the protocol.
* `baseTrackingIndex`: A Solidity `uint64` of the index of the account.
* `baseTrackingAccrued`: A Solidity `uint64` of the interest that the account has accrued.
* `assetsIn`: A Solidity `uint16` that tracks which assets the account has supplied as collateral. This storage implementation is for internal purposes and enables gas savings.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
UserBasic userBasic = comet.userBasic(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const [ principal, baseTrackingIndex, baseTrackingAccrued, assetsIn ] = await comet.methods.userBasic('0xAccount').call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ principal, baseTrackingIndex, baseTrackingAccrued, assetsIn ] = await comet.callStatic.userBasic('0xAccount');
```

### Get Asset Info

This method returns asset information such as the collateral factors, asset price feed address, and more. In order to create a loop to fetch information for every asset, use the `numAssets` constant, which indicates the total number of supported assets.

#### Comet

```solidity
struct AssetInfo {
    uint8 offset;
    address asset;
    address priceFeed;
    uint64 scale;
    uint64 borrowCollateralFactor;
    uint64 liquidateCollateralFactor;
    uint64 liquidationFactor;
    uint128 supplyCap;
}

function getAssetInfo(uint8 i) returns (AssetInfo memory)
```

* `i`: The index of the asset based on the order it was added to the protocol. The index begins at `0`.
* `RETURNS`: The asset information as a struct called `AssetInfo`.
* `offset`: The index of the asset based on the order it was added to the protocol.
* `asset`: The address of the asset's smart contract.
* `priceFeed`: The address of the price feed contract for this asset.
* `scale`: An integer that equals `10 ^ x` where `x` is the amount of decimal places in the asset's smart contract.
* `borrowCollateralFactor`: The collateral factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `liquidateCollateralFactor`: The liquidate collateral factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `liquidationFactor`: The liquidation factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `supplyCap`: The supply cap of the asset as an integer scaled up by `10 ^ x` where `x` is the amount of decimal places in the asset's smart contract.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
AssetInfo info = comet.getAssetInfo(0);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const infoObject = await comet.methods.getAssetInfo(0).call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const infoObject = await comet.callStatic.getAssetInfo(0);
```

### Get Price

The protocol's prices are updated by [Chainlink Price Feeds](https://data.chain.link/). In order to fetch the present price of an asset, the price feed contract address for that asset must be passed to the `getPrice` function.

This function returns the price of an asset in USD with 8 decimal places.

#### Comet

```solidity
function getPrice(address priceFeed) returns (uint128)
```

* `priceFeed`: The ERC-20 address of the Chainlink price feed contract for the asset.
* `RETURNS`: Returns the USD price with 8 decimal places as an unsigned integer scaled up by `10 ^ 8`. E.g. `500000000000` means that the asset's price is $5000 USD.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint price = comet.getPrice(0xAssetAddress);
```

#### Web3.js v1.5.x

```js
const Comet = new web3.eth.Contract(abiJson, contractAddress);
const price = await Comet.methods.getPrice(usdcAddress).call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const price = await comet.callStatic.getPrice(usdcAddress);
```

## Bulk Actions

The Compound III codebase contains the source code of an external contract called *Bulker* that is designed to allow multiple Comet functions to be called in a single transaction.

Use cases of the Bulker contract include but are not limited to:
  * Supplying of a collateral asset and borrowing of the base asset.
  * Supplying or withdrawing of the native EVM token (like Ether) directly.
  * Transferring or withdrawing of the base asset without leaving dust in the account.

### Invoke

This function allows callers to pass an array of action codes and calldatas that are executed, one by one, in a single transaction.

#### Bulker

```solidity
uint public constant ACTION_SUPPLY_ASSET = 1;
uint public constant ACTION_SUPPLY_ETH = 2;
uint public constant ACTION_TRANSFER_ASSET = 3;
uint public constant ACTION_WITHDRAW_ASSET = 4;
uint public constant ACTION_WITHDRAW_ETH = 5;

function invoke(uint[] calldata actions, bytes[] calldata data) external payable
```

* `actions`: An array of integers that correspond to the actions defined in the contract constructor.
* `data`: An array of calldatas for each action to be called in the invoke transaction.
  * Supply Asset, Withdraw Asset, Transfer Asset
    * `to`: The destination address, within or external to the protocol.
    * `asset`: The address of the ERC-20 asset contract.
    * `amount`: The amount of the asset as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.
  * Supply ETH, Withdraw ETH (or equivalent native chain token)
    * `to`: The destination address, within or external to the protocol.
    * `amount`: The amount of the native token as an unsigned integer scaled up by 10 to the number of decimals of precision of the native EVM token.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Bulker bulker = Bulker(0xBulkerAddress);
// ERC-20 `approve` the bulker. Then Comet `allow` the bulker to be a manager before calling `invoke`.
bytes memory supplyAssetCalldata = (abi.encode('0xAccount', '0xAsset', amount);
bulker.invoke([ 1 ], [ supplyAssetCalldata ]);
```

#### Web3.js v1.5.x

```js
const Bulker = new web3.eth.Contract(abiJson, contractAddress);
// ERC-20 `approve` the bulker. Then Comet `allow` the bulker to be a manager before calling `invoke`.
const supplyAssetCalldata = web3.eth.abi.encodeParameters(['address', 'address', 'uint'], ['0xAccount', '0xAsset', amount]);
await Bulker.methods.invoke([ 1 ], [ supplyAssetCalldata ]).send();
```

#### Ethers.js v5.x

```js
const bulker = new ethers.Contract(contractAddress, abiJson, provider);
// ERC-20 `approve` the bulker. Then Comet `allow` the bulker to be a manager before calling `invoke`.
const supplyAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], ['0xAccount', '0xAsset', amount]);
await bulker.invoke([ 1 ], [ supplyAssetCalldata ]);
```

## Governance

Compound III is a decentralized protocol that is governed by holders and delegates of COMP. Governance allows the community to propose, vote, and implement changes through the administrative smart contract functions of the Compound III protocol. For more information on the [governance](https://compound.finance/docs/governance) system see the governance section.

### Withdraw Reserves

This function allows governance to withdraw base token reserves from the protocol and send them to a specified address. Only the governor address may call this function.

#### Comet

```solidity
function withdrawReserves(address to, uint amount) external
```

* `to`: The address of the recipient of the base asset tokens.
* `amount`: The amount of the base asset to send scaled up by 10 to the "decimals" integer in the base asset's contract.
* `RETURN`: No return, reverts on error.
