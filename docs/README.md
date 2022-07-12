# Compound III

## Introduction

Compound III is an EVM compatible protocol that enables supplying of crypto assets as collateral in order to borrow the *base asset*. Accounts can also earn interest by supplying the base asset to the protocol.

The initial deployment of Compound III is on Ethereum and the base asset is USDC.

The [app.compound.finance](https://app.compound.finance) interface is [open-source](https://github.com/compound-finance/palisade), deployed to IPFS, and is maintained by the community.

Please join the #development room in the Compound community [Discord](https://compound.finance/discord) server as well as the forums at [comp.xyz](https://comp.xyz); Compound Labs and members of the community look forward to helping you build an application on top of Compound III. Your questions help us improve, so please don't hesitate to ask if you can't find what you are looking for here.

For documentation of the Compound v2 Protocol, see [compound.finance/docs](https://compound.finance/docs).

## Interest Rates

Users with a positive balance of the base asset earn interest, denominated in the base asset, based on a supply rate model; users with a negative balance pay interest based on a borrow rate model. These are separate interest rate models, and set by governance.

The supply and borrow interest rates are a function of the utilization rate of the base asset. Each model includes a utilization rate "kink" - above this point the interest rate increases more rapidly. Interest accrues every second using the block timestamp.

Collateral assets do not earn or pay interest.

### Get Supply Rate

This function returns the per second supply rate as the decimal representation of a percentage scaled up by `10 ^ 18`. The formula for producing the supply rate is:

```
## If the Utilization is less than or equal to the Kink parameter

SupplyRate = (InterestRateBase + InterestRateSlopeLow * Utilization) * Utilization * (1 - ReserveRate)

## Else

SupplyRate = (InterestRateBase + InterestRateSlopeLow * Kink + InterestRateSlopeHigh * (Utilization - Kink)) * Utilization * (1 - ReserveRate)
```

To calculate the Compound III supply APR as a percentage, pass the current utilization to this function, and divide the result by `10 ^ 18` and multiply by the approximate number of seconds in one year and scale up by 100.

```
Seconds Per Year = 60 * 60 * 24 * 365
Utilization = getUtilization()
Supply Rate = getSupplyRate(Utilization)
Supply APR = Supply Rate / (10 ^ 18) * Seconds Per Year * 100
```

#### Comet

```solidity
function getSupplyRate(uint utilization) public view returns (uint64)
```

* `utilization`: The utilization at which to calculate the rate.
* `RETURNS`: The per second supply rate as the decimal representation of a percentage scaled up by `10 ^ 18`. E.g. `317100000` indicates, roughly, a 1% APR.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint supplyRate = comet.getSupplyRate(0.8e18);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const supplyRate = await comet.callStatic.getSupplyRate(0.8e18);
```

</p>
</details>

### Get Borrow Rate

This function returns the per second borrow rate as the decimal representation of a percentage scaled up by `10 ^ 18`. The formula for producing the borrow rate is:

```
## If the Utilization is less than or equal to the Kink parameter

BorrowRate = InterestRateBase + InterestRateSlopeLow * Utilization

## Else

BorrowRate = InterestRateBase + InterestRateSlopeLow * Kink + InterestRateSlopeHigh * (Utilization - Kink)
```

To calculate the Compound III borrow APR as a percentage, pass the current utilization to this function, and divide the result by `10 ^ 18` and multiply by the approximate number of seconds in one year and scale up by 100.

```
Seconds Per Year = 60 * 60 * 24 * 365
Utilization = getUtilization()
Borrow Rate = getBorrowRate(Utilization)
Borrow APR = Borrow Rate / (10 ^ 18) * Seconds Per Year * 100
```

#### Comet

```solidity
function getBorrowRate(uint utilization) public view returns (uint64)
```

* `utilization`: The utilization at which to calculate the rate.
* `RETURNS`: The per second borrow rate as the decimal representation of a percentage scaled up by `10 ^ 18`. E.g. `317100000` indicates, roughly, a 1% APR.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint borrowRate = comet.getBorrowRate(0.8e18);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const borrowRate = await comet.callStatic.getBorrowRate(0.8e18);
```

</p>
</details>

### Get Utilization

This function returns the current protocol utilization of the base asset. The formula for producing the utilization is:

`Utilization = TotalBorrows / TotalSupply`

#### Comet

```solidity
function getUtilization() public view returns (uint)
```

* `RETURNS`: The current protocol utilization percentage as a decimal, represented by an unsigned integer, scaled up by `10 ^ 18`. E.g. `1e17 or 100000000000000000` is 10% utilization.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint utilization = comet.getUtilization(); // example: 10000000000000000 (1%)
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const utilization = await comet.callStatic.getUtilization();
```

</p>
</details>

## Collateral & Borrowing

Users can add collateral assets to their account using the *[supply](#supply)* function. Collateral can only be added if the market is below its *[supplyCap](#get-asset-info-by-address)*, which limits the protocol's risk exposure to collateral assets.

Each collateral asset increases the user's borrowing capacity, based on the asset's *[borrowCollateralFactor](#get-asset-info-by-address)*. The borrowing collateral factors are percentages that represent the portion of collateral value that can be borrowed.

For instance, if the borrow collateral factor for WBTC is 85%, an account can borrow up to 85% of the USD value of its supplied WBTC in the base asset. Collateral factors can be fetched using the *[Get Asset Info By Address](#get-asset-info-by-address)* function.

The base asset can be borrowed using the *[withdraw](#withdraw)* function; the resulting borrow balance must meet the borrowing collateral factor requirements. If a borrowing account subsequently fails to meet the borrow collateral factor requirements, it cannot borrow additional assets until it supplies more collateral, or reduces its borrow balance using the supply function.

Account *balances* for the base token are signed integers. An account balance greater than zero indicates the base asset is supplied and a balance less than zero indicates the base asset is borrowed. *Note: Base token balances for assets with 18 decimals will start to overflow at a value of 2<sup>103</sup>/1e18=~10 trillion.*

Account balances are stored internally in Comet as *principal* values (also signed integers). The principal value, also referred to as the day-zero balance, is what an account balance at *T<sub>0</sub>* would have to be for it to be equal to the account balance today after accruing interest.

Global *indices* for supply and borrow are unsigned integers that increase over time to account for the interest accrued on each side. When an account interacts with the protocol, the indices are updated and saved. An account's present balance can be calculated using the current index with the following formulas.

```
Balance=Principal * BaseSupplyIndex [Principal>0]
Balance=Principal * BaseBorrowIndex [Principal<0]
```

### Supply

The supply function transfers an asset to the protocol and adds it to the account's balance. This function can be used to **supply collateral, supply the base asset, or repay an open borrow** of the base asset.

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
* `amount`: The amount of the asset to supply to Compound III expressed as an integer. A value of `MaxUint256` will repay all of the `dst`'s base borrow balance.
* `dst`: The address that is credited with the supplied asset within the protocol.
* `from`: The address to supply from. This account must first use the Allow method in order to allow the sender to transfer its tokens prior to calling Supply.
* `RETURN`: No return, reverts on error.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
comet.supply(0xERC20Address, 1000000);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.supply(usdcAddress, 1000000);
```

</p>
</details>

### Withdraw

The withdraw method is used to **withdraw collateral** that is not currently supporting an open borrow. Withdraw is **also used to borrow the base asset** from the protocol if the account has supplied sufficient collateral. It can also be called from an allowed manager address.

Compound III implements a minimum borrow position size which can be found as `baseBorrowMin` in the [protocol configuration](#get-protocol-configuration). A withdraw transaction to borrow that results in the account's borrow size being less than the `baseBorrowMin` will revert.

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
* `amount`: The amount of the asset to withdraw or borrow. A value of `MaxUint256` will withdraw all of the `src`'s base balance.
* `to`: The address to send the withdrawn or borrowed asset.
* `src`: The address of the account to withdraw or borrow on behalf of. The `withdrawFrom` method can only be called by an allowed manager.
* `RETURN`: No return, reverts on error.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
comet.withdraw(0xwbtcAddress, 100000000);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.withdraw(usdcAddress, 100000000);
```

</p>
</details>

### Collateral Balance

This function returns the current balance of a collateral asset for a specified account in the protocol.

#### Comet

```solidity
function collateralBalanceOf(address account, address asset) external view returns (uint128)
```

* `account`: The address of the account in which to retrieve a collateral balance.
* `asset`: The address of the collateral asset smart contract.
* `RETURNS`: The balance of the collateral asset in the protocol for the specified account as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint balance = comet.collateralBalanceOf(0xAccount, 0xUsdcAddress);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const balance = await comet.callStatic.collateralBalanceOf('0xAccount', '0xUsdcAddress');
```

</p>
</details>

### Borrow Collateralization

This function returns true if the account passed to it has non-negative liquidity based on the borrow collateral factors. This function returns false if an account does not have sufficient liquidity to increase its borrow position. A return value of false does not necessarily imply that the account is presently liquidatable (see *[isLiquidatable](#liquidatable-accounts)* function).

#### Comet

```solidity
function isBorrowCollateralized(address account) public view returns (bool)
```

* `account`: The account to examine collateralization.
* `RETURNS`: Returns true if the account has enough liquidity for borrowing.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
bool isCollateralized = comet.isBorrowCollateralized(0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const isCollateralized = await comet.callStatic.isBorrowCollateralized('0xAccount');
```

</p>
</details>

## Liquidation

Liquidation is determined by *[liquidation collateral factors](#get-asset-info-by-address)*, which are separate and higher than borrow collateral factors (used to determine initial borrowing capacity), which protects borrowers & the protocol by ensuring a price buffer for all new positions. These also enable governance to reduce borrow collateral factors without triggering the liquidation of existing positions.

When an account's borrow balance exceeds the limits set by liquidation collateral factors, it is eligible for liquidation. A liquidator (a bot, contract, or user) can call the *[absorb](#absorb)* function, which relinquishes ownership of the accounts collateral, and returns the value of the collateral, minus a penalty (*[liquidationFactor](#get-asset-info-by-address)*), to the user in the base asset. The liquidated user has no remaining debt, and typically, will have an excess (interest earning) balance of the base asset.

Each absorption is paid for by the protocol's reserves of the base asset. In return, the protocol receives the collateral assets. If the remaining reserves are less than a governance-set *[target](#target-reserves)*, liquidators are able to *[buy](#buy-collateral)* the collateral at a *[discount](#ask-price)* using the base asset, which increases the protocol's base asset reserves.

### Liquidatable Accounts

This function returns true if the account passed to it has negative liquidity based on the liquidation collateral factor. A return value of true indicates that the account is presently liquidatable.

#### Comet

```solidity
function isLiquidatable(address account) public view returns (bool)
```

* `account`: The account to examine liquidatability.
* `RETURNS`: Returns true if the account is presently able to be liquidated.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
bool isLiquidatable = comet.isLiquidatable(0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const isLiquidatable = await comet.callStatic.isLiquidatable('0xAccount');
```

</p>
</details>

### Absorb

This function can be called by any address to liquidate an underwater account. It transfers the account's debt to the protocol account, decreases cash reserves to repay the account's borrows, and adds the collateral to the protocol's own balance. The caller has the amount of gas spent noted. In the future, they could be compensated via governance.

#### Comet

```solidity
function absorb(address absorber, address[] calldata accounts)
```

* `absorber`:  The account that is issued liquidator points during successful execution.
* `accounts`:  An array of underwater accounts that are to be liquidated.
* `RETURN`: No return, reverts on error.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
comet.absorb(0xMyAddress, [ 0xUnderwaterAddress ]);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.absorb('0xMyAddress', [ '0xUnderwaterAddress' ]);
```

</p>
</details>

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

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
comet.buyCollateral(0xAssetAddress, 5e18, 5e18, 0xRecipient);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.buyCollateral('0xAssetAddress', 5e18, 5e18, '0xRecipient');
```

</p>
</details>

### Ask Price

In order to repay the borrows of absorbed accounts, the protocol needs to sell the seized collateral. The *Ask Price* is the price of the asset to be sold at a discount (configured by governance). This function uses the price returned by the protocol's price feed. The discount of the asset is derived from the `StoreFrontPriceFactor` and the asset's `LiquidationFactor` using the following formula.

```
DiscountFactor = StoreFrontPriceFactor * (1e18 - Asset.LiquidationFactor)
```

#### Comet

```solidity
function quoteCollateral(address asset, uint baseAmount) public view returns (uint)
```

* `address`:  The address of the asset which is being queried.
* `amount`:  The amount of the asset to be sold.
* `RETURN`: No return, reverts on error.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint askPrice = comet.quoteCollateral(0xERC20Address, 10000000000);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const askPrice = await comet.callStatic.quoteCollateral('0xERC20Address', 1000000);
```

</p>
</details>

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

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
LiquidatorPoints pointsData = comet.liquidatorPoints(0xLiquidatorAddress);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ numAbsorbs, numAbsorbed, approxSpend ] = await comet.callStatic.liquidatorPoints('0xLiquidatorAddress');
```

</p>
</details>

## Reserves

Reserves are a balance of the base asset, stored internally in the protocol, which automatically protect users from bad debt. Reserves can also be withdrawn or used through the governance process.

Reserves are generated in two ways: the difference in interest paid by borrowers, and earned by suppliers of the base asset, accrue as reserves into the protocol. Second, the [liquidation](#liquidation) process uses, and can add to, protocol reserves based on the [target reserve](#target-reserves) level set by governance.

### Get Reserves

This function returns the amount of protocol reserves for the base asset as an integer.

#### Comet

```solidity
function getReserves() public view returns (int)
```

* `RETURNS`: The amount of base asset stored as reserves in the protocol as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint reserves = comet.getReserves();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const reserves = await comet.callStatic.getReserves();
```

</p>
</details>

### Target Reserves

This immutable value represents the target amount of reserves of the base token. If the protocol holds greater than or equal to this amount of reserves, the *[buyCollateral](#buy-collateral)* function can no longer be successfully called.

#### Comet

```solidity
function targetReserves() public view returns (uint)
```

* `RETURN`: The target reserve value of the base asset as an integer, scaled up by 10 to the "decimals" integer in the base asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint targetReserves = comet.targetReserves();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const targetReserves = await comet.callStatic.targetReserves();
```

</p>
</details>

## Protocol Rewards

Compound III has a built-in system for tracking rewards for accounts that use the protocol. The full history of accrual of rewards are tracked for suppliers and borrowers of the base asset. The rewards can be any ERC-20 token. In order for rewards to accrue to Compound III accounts, the configuration's `baseMinForRewards` threshold for total supply of the base asset must be met.

### Reward Accrual Tracking

The reward accrual is tracked in the Comet contract and rewards can be claimed by users from an external Comet Rewards contract. Rewards are accounted for with up to 6 decimals of precision.

#### Comet

```solidity
function baseTrackingAccrued(address account) external view returns (uint64);
```

* `RETURNS`: Returns the amount of reward token accrued based on usage of the base asset within the protocol for the specified account, scaled up by `10 ^ 6`.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint64 accrued = comet.baseTrackingAccrued(0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const accrued = await comet.callStatic.baseTrackingAccrued('0xAccount');
```

</p>
</details>

### Get Reward Accrued

The amount of reward token accrued but not yet claimed for an account can be fetched from the external Comet Rewards contract.

#### Comet Rewards

```solidity
struct RewardOwed {
    address token;
    uint owed;
}

function getRewardOwed(address comet, address account) external returns (RewardOwed memory)
```

* `RETURNS`: Returns the amount of reward token accrued but not yet claimed, scaled up by 10 to the "decimals" integer in the reward token's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
CometRewards rewards = CometRewards(0xRewardsAddress);
RewardOwed reward = rewards.getRewardOwed(0xCometAddress, 0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const rewards = new ethers.Contract(contractAddress, abiJson, provider);
const [ tokenAddress, amtOwed ] = await rewards.callStatic.getRewardOwed(cometAddress, accountAddress);
```

</p>
</details>

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

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
CometRewards rewards = CometRewards(0xRewardsAddress);
rewards.claim(0xCometAddress, 0xAccount, true);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const rewards = new ethers.Contract(contractAddress, abiJson, provider);
await rewards.claim(cometAddress, accountAddress, true);
```

</p>
</details>

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

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
comet.allow(0xmanager, true);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.allow(managerAddress, true);
```

</p>
</details>

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
* `expiry`: The time at which the signature expires. A block timestamp as seconds since the Unix epoch (uint).
* `v`: The recovery byte of the signature.
* `r`: Half of the ECDSA signature pair.
* `s`: Half of the ECDSA signature pair.
* `RETURN`: No return, reverts on error.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
comet.allowBySig(0xowner, 0xmanager, true, nonce, expiry, v, r, s);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.allowBySig('0xowner', '0xmanager', true, nonce, expiry, v, r, s);
```

</p>
</details>

### Account Permissions

This function returns a boolean that indicates the status of an account's management address.

#### Comet

```solidity
function hasPermission(address owner, address manager) public view returns (bool)
```

* `owner`: The address of an account that can be managed by another.
* `manager`: The address of the account that can have manager permissions over another.
* `RETURNS`: Returns true if the `manager` address is presently a manager of the `owner` address.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
bool isManager = comet.hasPermission(0xOwner, 0xManager);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const isManager = await comet.callStatic.hasPermission('0xOwner', '0xManager');
```

</p>
</details>

### Transfer

This function is used to transfer an asset within the protocol to another address. A manager of an account is also able to perform a transfer on behalf of the account. Account balances change but the asset does not leave the protocol contract. The transfer will fail if it would make the account liquidatable.

There are two variants of the transfer function: `transfer` and `transferAsset`. The former conforms to the ERC-20 standard and transfers the base asset, while the latter requires specifying a specific asset to transfer.

#### Comet

```solidity
function transfer(address dst, uint amount)
```

```solidity
function transferFrom(address src, address dst, uint amount)
```

```solidity
function transferAsset(address dst, address asset, uint amount)
```

```solidity
function transferAssetFrom(address src, address dst, address asset, uint amount)
```

* `dst`: The address of an account that is the receiver in the transaction.
* `src`: The address of an account that is the sender of the asset in the transaction. This transfer method can only be called by an allowed manager.
* `asset`: The ERC-20 address of the asset that is being sent in the transaction.
* `amount`: The amount of the asset to transfer. A value of `MaxUint256` will transfer all of the `src`'s base balance.
* `RETURN`: No return, reverts on error.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
comet.transfer(0xreceiver, 0xwbtcAddress, 100000000);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.transfer(receiverAddress, usdcAddress, 100000000);
```

</p>
</details>

### Interfaces & ERC-20 Compatibility

The Comet contract is a fully compatible ERC-20 wrapper for the base token. All of the interface methods of ERC-20 are externally exposed for accounts that supply or borrow. The **CometInterface.sol** contract file contains an example of a Solidity interface for the Comet contract.

## Helper Functions

### Total Supply

The total supply of base tokens supplied to the protocol plus interest accrued to suppliers.

#### Comet

```solidity
function totalSupply() override external view returns (uint256)
```

* `RETURN`: The amount of base asset scaled up by 10 to the "decimals" integer in the base asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint256 totalSupply = comet.totalSupply();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const totalSupply = await comet.callStatic.totalSupply();
```

</p>
</details>

### Total Borrow

The total amount of base tokens that are currently borrowed from the protocol plus interest accrued to all borrows.

#### Comet

```solidity
function totalBorrow() virtual external view returns (uint256)
```

* `RETURN`: The amount of base asset scaled up by 10 to the "decimals" integer in the base asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint256 totalBorrow = comet.totalBorrow();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const totalBorrow = await comet.callStatic.totalBorrow();
```

</p>
</details>

### Total Collateral

The protocol tracks the current amount of collateral that all accounts have supplied. Each valid collateral asset sum is tracked in a mapping with the asset address that points to a struct.

#### Comet

```solidity
struct TotalsCollateral {
    uint128 totalSupplyAsset;
    uint128 _reserved;
}

mapping(address => TotalsCollateral) public totalsCollateral;
```

* `address`:  The address of the collateral asset's contract.
* `RETURN`: A struct containing the stored data pertaining to the sum of the collateral in the protocol.
* `totalSupplyAsset`: A Solidity `uint128` of the sum of the collateral asset stored in the protocol, scaled up by 10 to the "decimals" integer in the asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
TotalsCollateral totalsCollateral = comet.totalsCollateral(0xERC20Address);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ totalSupplyAsset ] = await comet.callStatic.totalsCollateral('0xERC20Address');
```

</p>
</details>

### Supplied Base Balance

This function returns the current balance of base asset for a specified account in the protocol, including interest. If the account is presently borrowing or not supplying, it will return `0`.

#### Comet

```solidity
function balanceOf(address account) external view returns (uint256)
```

* `account`: The address of the account in which to retrieve the base asset balance.
* `RETURNS`: The balance of the base asset, including interest, in the protocol for the specified account as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint balance = comet.balanceOf(0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const balance = await comet.callStatic.balanceOf('0xAccount');
```

</p>
</details>

### Borrow Balance

This function returns the current balance of borrowed base asset for a specified account in the protocol, including interest. If the account has a non-negative base asset balance, it will return `0`.

#### Comet

```solidity
function borrowBalanceOf(address account) external view returns (uint256)
```

* `account`: The address of the account in which to retrieve the borrowed base asset balance.
* `RETURNS`: The balance of the base asset, including interest, borrowed by the specified account as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint owed = comet.borrowBalanceOf(0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const owed = await comet.callStatic.borrowBalanceOf('0xAccount');
```

</p>
</details>

### Base Balance as Integer

This function returns the current balance of base asset for a specified account in the protocol, including interest. If the account is currently borrowing, the return value will be negative. If the account is currently supplying the base asset, the return value will be positive.

#### Comet

```solidity
function baseBalanceOf(address account) external view returns (int104)
```

* `account`: The address of the account in which to retrieve the base asset balance.
* `RETURNS`: The balance of the base asset, including interest, that the specified account is due as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint baseBalance = comet.baseBalanceOf(0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const baseBalance = await comet.callStatic.baseBalanceOf('0xAccount');
```

</p>
</details>

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

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
UserBasic userBasic = comet.userBasic(0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ principal, baseTrackingIndex, baseTrackingAccrued, assetsIn ] = await comet.callStatic.userBasic('0xAccount');
```

</p>
</details>

### Get Asset Info

This function returns asset information such as the collateral factors, asset price feed address, and more. In order to create a loop to fetch information for every asset, use the `numAssets` constant, which indicates the total number of supported assets.

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

function getAssetInfo(uint8 i) public view returns (AssetInfo memory)
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

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
AssetInfo info = comet.getAssetInfo(0);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const infoObject = await comet.callStatic.getAssetInfo(0);
```

</p>
</details>

### Get Asset Info By Address

This function returns asset information of a specific asset.

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

function getAssetInfoByAddress(address asset) public view returns (AssetInfo memory)
```

* `address`: The address of the asset.
* `RETURNS`: The asset information as a struct called `AssetInfo`.
* `offset`: The index of the asset based on the order it was added to the protocol.
* `asset`: The address of the asset's smart contract.
* `priceFeed`: The address of the price feed contract for this asset.
* `scale`: An integer that equals `10 ^ x` where `x` is the amount of decimal places in the asset's smart contract.
* `borrowCollateralFactor`: The collateral factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `liquidateCollateralFactor`: The liquidate collateral factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `liquidationFactor`: The liquidation factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `supplyCap`: The supply cap of the asset as an integer scaled up by `10 ^ x` where `x` is the amount of decimal places in the asset's smart contract.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
AssetInfo info = comet.getAssetInfoByAddress(0xAsset);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const infoObject = await comet.callStatic.getAssetInfoByAddress('0xAsset');
```

</p>
</details>

### Get Price

The protocol's prices are updated by [Chainlink Price Feeds](https://data.chain.link/). In order to fetch the present price of an asset, the price feed contract address for that asset must be passed to the `getPrice` function.

This function returns the price of an asset in USD with 8 decimal places.

#### Comet

```solidity
function getPrice(address priceFeed) public view returns (uint128)
```

* `priceFeed`: The ERC-20 address of the Chainlink price feed contract for the asset.
* `RETURNS`: Returns the USD price with 8 decimal places as an unsigned integer scaled up by `10 ^ 8`. E.g. `500000000000` means that the asset's price is $5000 USD.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint price = comet.getPrice(0xAssetAddress);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const price = await comet.callStatic.getPrice(usdcAddress);
```

</p>
</details>

### Accrue Account

This function triggers a manual accrual of interest and rewards to an account.

#### Comet

```solidity
function accrueAccount(address account) override external
```

* `account`: The account in which to accrue interest and rewards.
* `RETURN`: No return, reverts on error.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint price = comet.accrueAccount(0xAccount);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.accrueAccount('0xAccount');
```

</p>
</details>

### Get Protocol Configuration

This function returns the configuration struct stored for a specific instance of Comet in the configurator contract.

#### Configurator

```solidity
struct Configuration {
    address governor;
    address pauseGuardian;
    address baseToken;
    address baseTokenPriceFeed;
    address extensionDelegate;

    uint64 kink;
    uint64 perYearInterestRateSlopeLow;
    uint64 perYearInterestRateSlopeHigh;
    uint64 perYearInterestRateBase;
    uint64 reserveRate;
    uint64 storeFrontPriceFactor;
    uint64 trackingIndexScale;
    uint64 baseTrackingSupplySpeed;
    uint64 baseTrackingBorrowSpeed;
    uint104 baseMinForRewards;
    uint104 baseBorrowMin;
    uint104 targetReserves;

    AssetConfig[] assetConfigs;
}

function getConfiguration(address cometProxy) external view returns (Configuration memory)
```

* `cometProxy`: The address of the Comet proxy to get the configuration for.
* `RETURNS`: Returns the protocol configuration.
  * `governor`: The address of the protocol Governor.
  * `pauseGuardian`: The address of the protocol pause guardian.
  * `baseToken`: The address of the protocol base token smart contract.
  * `baseTokenPriceFeed`: The address of the protocol base token price feed smart contract.
  * `extensionDelegate`: The address of the delegate of extra methods that did not fit in Comet.sol (CometExt.sol).
  * `kink`: The interest rate utilization curve kink.
  * `perYearInterestRateSlopeLow`: The interest rate slope low bound.
  * `perYearInterestRateSlopeHigh`: The interest rate slope high bound.
  * `perYearInterestRateBase`: The interest rate slope base.
  * `reserveRate`: The reserve rate that borrowers pay to the protocol reserves.
  * `storeFrontPriceFactor`: The fraction of the liquidation penalty that goes to buyers of collateral instead of the protocol.
  * `trackingIndexScale`: The scale for the index tracking protocol rewards.
  * `baseTrackingSupplySpeed`: The rate for protocol awards accrued to suppliers.
  * `baseTrackingBorrowSpeed`: The rate for protocol awards accrued to borrowers.
  * `baseMinForRewards`: The minimum amount of base asset supplied to the protocol in order for accounts to accrue rewards.
  * `baseBorrowMin`: The minimum allowed borrow size.
  * `targetReserves`: The amount of reserves allowed before absorbed collateral is no longer sold by the protocol.
  * `assetConfigs`: An array of all supported asset configurations.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Configurator configurator = Configurator(0xConfiguratorAddress);
Configuration config = configurator.getConfiguration(0xCometProxy);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const configurator = new ethers.Contract(contractAddress, abiJson, provider);
const config = await configurator.callStatic.getConfiguration(0xCometProxy);
```

</p>
</details>

### Get Base Asset Market Information

This function gets several of the current parameter values for the protocol market.

#### Comet

```solidity
struct TotalsBasic {
    uint64 baseSupplyIndex;
    uint64 baseBorrowIndex;
    uint64 trackingSupplyIndex;
    uint64 trackingBorrowIndex;
    uint104 totalSupplyBase;
    uint104 totalBorrowBase;
    uint40 lastAccrualTime;
    uint8 pauseFlags;
}

function totalsBasic() public override view returns (TotalsBasic memory)
```

* `RETURNS`: The base asset market information as a struct called `TotalsBasic` (defined in CometStorage.sol).
* `baseSupplyIndex`: The global base asset supply index for calculating interest accrued to suppliers.
* `baseBorrowIndex`: The global base asset borrow index for calculating interest owed by borrowers.
* `trackingSupplyIndex`: A global index for tracking participation of accounts that supply the base asset.
* `trackingBorrowIndex`:  A global index for tracking participation of accounts that borrow the base asset.
* `totalSupplyBase`: The total amount of base asset presently supplied to the protocol as an unsigned integer scaled up by 10 to the "decimals" integer in the base asset's contract.
* `totalBorrowBase`: The total amount of base asset presently borrowed from the protocol as an unsigned integer scaled up by 10 to the "decimals" integer in the base asset's contract.
* `lastAccrualTime`: The most recent time that protocol interest accrual was globally calculated. A block timestamp as seconds since the Unix epoch.
* `pauseFlags`: An integer that represents paused protocol functionality flags that are packed for data storage efficiency. See [Pause Protocol Functionality](#pause-protocol-functionality).

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
TotalsBasic tb = comet.totalsBasic();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ baseSupplyIndex, baseBorrowIndex, trackingSupplyIndex, trackingBorrowIndex, totalSupplyBase, totalBorrowBase, lastAccrualTime, pauseFlags ] = await comet.callStatic.totalsBasic();
```

</p>
</details>

### Get Base Accrual Scale

This function gets the scale for the base asset tracking accrual.

#### Comet

```solidity
function baseAccrualScale() override external pure returns (uint64)
```

* `RETURNS`: The integer used to scale down the base accrual when calculating a decimal value.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint baseAccrualScale = comet.baseAccrualScale();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const baseAccrualScale = await comet.callStatic.baseAccrualScale();
```

</p>
</details>

### Get Base Index Scale

This function gets the scale for the base asset index.

#### Comet

```solidity
function baseIndexScale() override external pure returns (uint64)
```

* `RETURNS`: The integer used to scale down the index when calculating a decimal value.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint baseIndexScale = comet.baseIndexScale();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const baseIndexScale = await comet.callStatic.baseIndexScale();
```

</p>
</details>

### Get Factor Scale

This function gets the scale for all protocol factors, i.e. borrow collateral factor.

#### Comet

```solidity
function factorScale() override external pure returns (uint64)
```

* `RETURNS`: The integer used to scale down the factor when calculating a decimal value.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint factorScale = comet.factorScale();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const factorScale = await comet.callStatic.factorScale();
```

</p>
</details>

### Get Price Scale

This function gets the scale integer for USD prices in the protocol, i.e. `8 decimals = 1e8`.

#### Comet

```solidity
function priceScale() override external pure returns (uint64)
```

* `RETURNS`: The integer used to scale down a price when calculating a decimal value.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint priceScale = comet.priceScale();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const priceScale = await comet.callStatic.priceScale();
```

</p>
</details>

### Get Max Assets

This function gets the maximum number of assets that can be simultaneously supported by Compound III.

#### Comet

```solidity
function maxAssets() override external pure returns (uint8)
```

* `RETURNS`: The maximum number of assets that can be simultaneously supported by Compound III.

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Comet comet = Comet(0xCometAddress);
uint maxAssets = comet.maxAssets();
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const maxAssets = await comet.callStatic.maxAssets();
```

</p>
</details>

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

<details>
<summary>
<b>
Solidity
</b>
</summary>
<p>

```solidity
Bulker bulker = Bulker(0xBulkerAddress);
// ERC-20 `approve` the bulker. Then Comet `allow` the bulker to be a manager before calling `invoke`.
bytes memory supplyAssetCalldata = (abi.encode('0xAccount', '0xAsset', amount);
bulker.invoke([ 1 ], [ supplyAssetCalldata ]);
```

</p>
</details>

<details>
<summary>
<b>
Ethers.js v5.x
</b>
</summary>
<p>

```js
const bulker = new ethers.Contract(contractAddress, abiJson, provider);
// ERC-20 `approve` the bulker. Then Comet `allow` the bulker to be a manager before calling `invoke`.
const supplyAssetCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint'], ['0xAccount', '0xAsset', amount]);
await bulker.invoke([ 1 ], [ supplyAssetCalldata ]);
```

</p>
</details>

## Governance

Compound III is a decentralized protocol that is governed by holders and delegates of COMP. Governance allows the community to propose, vote, and implement changes through the administrative smart contract functions of the Compound III protocol. For more information on the Governor and Timelock see the original [governance](https://compound.finance/docs/governance) section.

All instances of Compound III are controlled by the Timelock contract which is the same administrator of the Compound v2 protocol. The governance system has control over each *proxy*, the *Configurator implementation*, the *Comet factory*, and the *Comet implementation*.

Each time an immutable parameter is set via governance proposal, a new Comet implementation must be deployed by the Comet factory. If the proposal is approved by the community, the proxy will point to the new implementation upon execution.

To set specific protocol parameters in a proposal, the Timelock must call all of the relevant set methods on the *Configurator* contract, followed by `deployAndUpgradeTo` on the *CometProxyAdmin* contract.

### Set Comet Factory

This function sets the official contract address of the Comet factory. The only acceptable caller is the Governor.

#### Configurator

```solidity
function setFactory(address cometProxy, address newFactory) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newFactory`: The address of the new Comet contract factory.
* `RETURN`: No return, reverts on error.

### Set Governor

This function sets the official contract address of the Compound III protocol Governor for subsequent proposals.

#### Configurator

```solidity
function setGovernor(address cometProxy, address newGovernor) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newGovernor`: The address of the new Compound III Governor.
* `RETURN`: No return, reverts on error.

### Set Pause Guardian

This function sets the official contract address of the Compound III protocol pause guardian. This address has the power to pause supply, transfer, withdraw, absorb, and buy collateral operations within Compound III.

COMP token-holders designate the Pause Guardian address, which is held by the [Community Multi-Sig](https://etherscan.io/address/0xbbf3f1421d886e9b2c5d716b5192ac998af2012c).

#### Configurator

```solidity
function setPauseGuardian(address cometProxy, address newPauseGuardian) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newPauseGuardian`: The address of the new pause guardian.
* `RETURN`: No return, reverts on error.

### Pause Protocol Functionality

This function pauses the specified protocol functionality in the event of an unforeseen vulnerability. The only addresses that are allowed to call this function are the Governor and the Pause Guardian.

#### Comet

```solidity
function pause(
    bool supplyPaused,
    bool transferPaused,
    bool withdrawPaused,
    bool absorbPaused,
    bool buyPaused
) override external
```

* `supplyPaused`: Enables or disables all accounts' ability to supply assets to the protocol.
* `transferPaused`: Enables or disables all account's ability to transfer assets within the protocol.
* `withdrawPaused`: Enables or disables all account's ability to withdraw assets from the protocol.
* `absorbPaused`: Enables or disables protocol absorptions.
* `buyPaused`: Enables or disables the protocol's ability to sell absorbed collateral.
* `RETURN`: No return, reverts on error.

### Is Supply Paused

This function returns a boolean indicating whether or not the protocol supply functionality is presently paused.

#### Comet

```solidity
function isSupplyPaused() override public view returns (bool)
```

* `RETURN`: A boolean value of whether or not the protocol functionality is presently paused.

### Is Transfer Paused

This function returns a boolean indicating whether or not the protocol transfer functionality is presently paused.

#### Comet

```solidity
function isTransferPaused() override public view returns (bool)
```

* `RETURN`: A boolean value of whether or not the protocol functionality is presently paused.

### Is Withdraw Paused

This function returns a boolean indicating whether or not the protocol withdraw functionality is presently paused.

#### Comet

```solidity
function isWithdrawPaused() override public view returns (bool)
```

* `RETURN`: A boolean value of whether or not the protocol functionality is presently paused.

### Is Absorb Paused

This function returns a boolean indicating whether or not the protocol absorb functionality is presently paused.

#### Comet

```solidity
function isAbsorbPaused() override public view returns (bool)
```

* `RETURN`: A boolean value of whether or not the protocol functionality is presently paused.

### Is Buy Paused

This function returns a boolean indicating whether or not the protocol's selling of absorbed collateral functionality is presently paused.

#### Comet

```solidity
function isBuyPaused() override public view returns (bool)
```

* `RETURN`: A boolean value of whether or not the protocol functionality is presently paused.

### Set Base Token Price Feed

This function sets the official contract address of the price feed of the protocol base asset.

#### Configurator

```solidity
function setBaseTokenPriceFeed(address cometProxy, address newBaseTokenPriceFeed) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newBaseTokenPriceFeed`: The address of the new price feed contract.
* `RETURN`: No return, reverts on error.

### Set Extension Delegate

This function sets the official contract address of the protocol's Comet extension delegate. The methods in **CometExt.sol** are able to be called via the same proxy as **Comet.sol**.

#### Configurator

```solidity
function setExtensionDelegate(address cometProxy, address newExtensionDelegate) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newExtensionDelegate`: The address of the new extension delegate contract.
* `RETURN`: No return, reverts on error.

### Set Kink

This function sets the interest rate utilization curve kink for the Compound III base asset.

#### Configurator

```solidity
function setKink(address cometProxy, uint64 newKink) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newKink`: The new kink parameter.
* `RETURN`: No return, reverts on error.

### Set Interest Rate Slope (Low)

This function sets the interest rate slope low bound in the approximate amount of seconds in one year.

#### Configurator

```solidity
function setPerYearInterestRateSlopeLow(address cometProxy, uint64 newSlope) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newSlope`: The slope low bound as an unsigned integer.
* `RETURN`: No return, reverts on error.

### Set Interest Rate Slope (High)

This function sets the interest rate slope high bound in the approximate amount of seconds in one year.

#### Configurator

```solidity
function setPerYearInterestRateSlopeHigh(address cometProxy, uint64 newSlope) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newSlope`: The slope high bound as an unsigned integer.
* `RETURN`: No return, reverts on error.

### Set Interest Rate Slope (Base)

This function sets the interest rate slope base in the approximate amount of seconds in one year.

#### Configurator

```solidity
function setPerYearInterestRateBase(address cometProxy, uint64 newBase) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newSlope`: The slope base as an unsigned integer.
* `RETURN`: No return, reverts on error.

### Set Reserve Rate

This function sets the rate that reserves accumulate within the protocol as an APR. This is a percentage of interest paid by borrowers that goes to the protocol reserves.

#### Configurator

```solidity
function setReserveRate(address cometProxy, uint64 newReserveRate) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newReserveRate`: The reserve rate of the protocol as an APR scaled up by `10 ^ 18`. E.g. `250000000000000000` indicates a 2.5% APR.
* `RETURN`: No return, reverts on error.

### Set Store Front Price Factor

This function sets the fraction of the liquidation penalty that goes to buyers of collateral instead of the protocol. This factor is used to calculate the discount rate of collateral for sale as part of the account absorption process. The rate is a decimal scaled up by `10 ^ 18`.

#### Configurator

```solidity
function setStoreFrontPriceFactor(address cometProxy, uint64 newStoreFrontPriceFactor) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newStoreFrontPriceFactor`: The new price factor as an unsigned integer expressed as a decimal scaled up by `10 ^ 18`.
* `RETURN`: No return, reverts on error.

### Set Base Tracking Supply Speed

This function sets the rate at which base asset supplier accounts accrue rewards.

#### Configurator

```solidity
function setBaseTrackingSupplySpeed(address cometProxy, uint64 newBaseTrackingSupplySpeed) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newBaseTrackingSupplySpeed`: The rate as an APR expressed as a decimal scaled up by `10 ^ 18`.
* `RETURN`: No return, reverts on error.

### Set Base Tracking Borrow Speed

This function sets the rate at which base asset borrower accounts accrue rewards.

#### Configurator

```solidity
function setBaseTrackingBorrowSpeed(address cometProxy, uint64 newBaseTrackingBorrowSpeed) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newBaseTrackingBorrowSpeed`: The rate as an APR expressed as a decimal scaled up by `10 ^ 18`.
* `RETURN`: No return, reverts on error.

### Set Base Minimum For Rewards

This function sets the minimum amount of base asset supplied to the protocol in order for accounts to accrue rewards.

#### Configurator

```solidity
function setBaseMinForRewards(address cometProxy, uint104 newBaseMinForRewards) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newBaseMinForRewards`: The amount of base asset scaled up by 10 to the "decimals" integer in the base asset's contract.
* `RETURN`: No return, reverts on error.

### Set Borrow Minimum

This function sets the minimum amount of base token that is allowed to be borrowed.

#### Configurator

```solidity
function setBaseBorrowMin(address cometProxy, uint104 newBaseBorrowMin) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `setBaseBorrowMin`: The minimum borrow as an unsigned integer scaled up by 10 to the "decimals" integer in the base asset's contract.
* `RETURN`: No return, reverts on error.

### Set Target Reserves

This function sets the target reserves amount. Once the protocol reaches this amount of reserves of base asset, liquidators cannot buy collateral from the protocol.

#### Configurator

```solidity
function setTargetReserves(address cometProxy, uint104 newTargetReserves) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newTargetReserves`: The amount of reserves of base asset as an unsigned integer scaled up by 10 to the "decimals" integer in the base asset's contract.
* `RETURN`: No return, reverts on error.

### Add a New Asset

This function adds an asset to the protocol through governance.

#### Configurator

```solidity
function addAsset(address cometProxy, AssetConfig calldata assetConfig) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `assetConfig`: The configuration that is added to the array of protocol asset configurations.
* `RETURN`: No return, reverts on error.

### Update an Existing Asset

This function modifies an existing asset's configuration parameters.

#### Configurator

```solidity
function updateAsset(address cometProxy, AssetConfig calldata newAssetConfig) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `newAssetConfig`: The configuration that is modified in the array of protocol asset configurations. All parameters are overwritten.
* `RETURN`: No return, reverts on error.

### Update Asset Price Feed

This function updates the price feed contract address for a specific asset.

#### Configurator

```solidity
function updateAssetPriceFeed(address cometProxy, address asset, address newPriceFeed) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `asset`: The address of the underlying asset smart contract.
* `newPriceFeed`: The address of the new price feed smart contract.
* `RETURN`: No return, reverts on error.

### Update Borrow Collateral Factor

This function updates the borrow collateral factor for an asset in the protocol.

#### Configurator

```solidity
function updateAssetBorrowCollateralFactor(address cometProxy, address asset, uint64 newBorrowCF) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `asset`: The address of the underlying asset smart contract.
* `newBorrowCF`: The collateral factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `RETURN`: No return, reverts on error.

### Update Liquidation Collateral Factor

This function updates the liquidation collateral factor for an asset in the protocol.

#### Configurator

```solidity
function updateAssetLiquidateCollateralFactor(address cometProxy, address asset, uint64 newLiquidateCF) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `asset`: The address of the underlying asset smart contract.
* `newLiquidateCF`: The collateral factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `RETURN`: No return, reverts on error.

### Update Liquidation Factor

This function updates the liquidation factor for an asset in the protocol.

The liquidation factor is a decimal value that is between 0 and 1 (inclusive) which determines the amount that is paid out to an underwater account upon liquidation.

The following is an example of the liquidation factor's role in a Compound III liquidation:

An underwater account has supplied $100 of WBTC as collateral. If the WBTC liquidation factor is `0.9`, the user will receive $90 of the base asset when a liquidator triggers an absorption of their account.

#### Configurator

```solidity
function updateAssetLiquidationFactor(address cometProxy, address asset, uint64 newLiquidationFactor) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `asset`: The address of the underlying asset smart contract.
* `newLiquidationFactor`: The factor as an integer that represents the decimal value scaled up by `10 ^ 18`.
* `RETURN`: No return, reverts on error.

### Set Asset Supply Cap

This function sets the maximum amount of an asset that can be supplied to the protocol. Supply transactions will revert if the total supply would be greater than this number as a result.

#### Configurator

```solidity
function updateAssetSupplyCap(address cometProxy, address asset, uint128 newSupplyCap) external
```

* `cometProxy`: The address of the Comet proxy to set the configuration for.
* `asset`: The address of the underlying asset smart contract.
* `newSupplyCap`: The amount of the asset as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.
* `RETURN`: No return, reverts on error.

### ERC-20 Approve Manager Address

This function sets the Comet contract's ERC-20 allowance of an asset for a manager address. It can only be called by the Governor.

In the event of a governance attack, an attacker could create a proposal that leverages this function to give themselves permissions to freely transfer all ERC-20 tokens out of the Comet contract.

Hypothetically, the attacker would need to either acquire supreme voting weight or add a malicious step in an otherwise innocuous and popular proposal and the community would fail to detect before approving.

#### Comet

```solidity
function approveThis(address manager, address asset, uint amount) override external
```

* `manager`: The address of a manager account that has its allowance modified.
* `asset`: The address of the asset's smart contract.
* `amount`: The amount of the asset approved for the manager expressed as an integer.
* `RETURN`: No return, reverts on error.

### Transfer Governor

This function changes the address of the Configurator's Governor.

#### Configurator

```solidity
function transferGovernor(address newGovernor) external
```

* `newGovernor`: The address of the new Governor for Configurator.
* `RETURN`: No return, reverts on error.

### Withdraw Reserves

This function allows governance to withdraw base token reserves from the protocol and send them to a specified address. Only the Governor address may call this function.

#### Comet

```solidity
function withdrawReserves(address to, uint amount) external
```

* `to`: The address of the recipient of the base asset tokens.
* `amount`: The amount of the base asset to send scaled up by 10 to the "decimals" integer in the base asset's contract.
* `RETURN`: No return, reverts on error.
