# Compound v2.5

## Introduction

Compound Comet is a protocol on Ethereum which enables supplying of crypto assets as collateral in order to borrow the *base asset*, which is USDC. Accounts can also earn interest by supplying the base asset to the protocol. The codebase is [open-source](https://github.com/compound-finance/compound-comet), and maintained by the community.

The [comet.compound.finance](https://comet.compound.finance) interface is [open-source](https://github.com/compound-finance/palisade), deployed to IPFS, and is maintained by the community.

Please join the #development room in the Compound community [Discord](https://compound.finance/discord) server; Compound Labs and members of the community look forward to helping you build an application on top of Compound Comet. Your questions help us improve, so please don't hesitate to ask if you can't find what you are looking for here.

## Interest Rates

Compound Comet supply and borrow interest rates are bound by separate curves which are configured by governance. The current interest rates are single points on those curves.

**TODO: add more on interest rate calculation, TBD**

Accounts can earn interest by supplying the base asset. All other supported assets that can be supplied serve as collateral for borrowing and do not earn interest.

Owed interest accrues to open borrows of the base asset. Borrower interest accrues to accounts every second by using the block timestamp. In order to repay an open borrow and free up collateral for withdrawal, an account must supply the base asset that is owed to the protocol.

### Get Supply Rate

This method returns the current supply rate APY as the decimal representation of a percentage scaled up by `10 ^ 18`. The formula for producing the supply rate is:

`Utilization * SupplyRateSlope`

#### Comet

```solidity
function getSupplyRate() returns (uint)
```

* `RETURNS`: The current APY as the decimal representation of a percentage scaled up by `10 ^ 18`. E.g. `250000000000000000` indicates a 25% APY.

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

`BorrowRateBase + UtilizationBorrowRateSlope`

#### Comet

```solidity
function getBorrowRate() returns (uint)
```

* `RETURNS`:  The current APR as the decimal representation of a percentage scaled up by `10 ^ 18`. E.g. `90000000000000000` indicates a 9% APR.

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

Compound Comet accounts can supply crypto assets as collateral to borrow the base asset.

Account *balances* for the base token are signed integers. An account balance greater than zero indicates the base asset is supplied and a balance less than zero indicates the base asset is borrowed.

An account's *principal* is the amount of base the account was due at the time of the initial supply of base to the protocol. Global *indices* for supply and borrow are unsigned integers that increase over time. When an account interacts with the protocol, the indices are saved. An account's present balance can be calculated using the current index with the following formulae.

```
Balance=PrincipalBaseSupplyIndexNow [Principal0]
Balance=PrincipalBaseBorrowIndexNow [Principal<0]
```

### Supply

The supply function transfers an asset to the protocol and adds it to the account's balance. This method can be used to **supply collateral, supply the base asset, or repay an open borrow** of the base asset. If the base asset is supplied resulting in the account having a balance greater than zero, the base asset earns interest based on the current supply rate.

There are three separate methods to supply an asset to Comet. The first is on behalf of the caller, the second is to a separate account, and the third is for a manager on behalf of an account.

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
* `amount`: The amount of the asset to supply to Comet expressed as an integer.
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

#### Withdraw

The withdraw method is used to **withdraw collateral** that is not currently supporting an open borrow. Withdraw is **also used to borrow the base asset** from the protocol if there is sufficient collateral for the account. It can also be called from an allowed manager address. To check an account's present ability to increase its borrow size, see the *Borrow Collateralization* function.

The borrow collateral factors are percentages which represent the USD value of a supplied collateral that can be borrowed in the base asset. If the borrow collateral factor for WBTC is 85%, an account can borrow up to 85% of the USD value of its supplied WBTC in the base asset. Collateral factors can be fetched using the *[Get Asset Info](#get-asset-info)* function.

If a borrowing account subsequently no longer meets the borrow collateral factor requirements, it cannot increase the size of its borrow. An account can restore its ability to increase its borrow by repaying the borrow or supplying more collateral.

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

### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.withdraw(usdcAddress, 100000000).send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.withdraw(usdcAddress, 100000000);
```

## TODO: Getter function for how much an account can presently borrow

### Borrow Collateralization

This function returns true if the account passed to it has non-negative liquidity based on the borrow collateral factors. This function returns false if an account does not have sufficient liquidity to increase its borrow position. A return value of false does not necessarily imply that the account is presently liquidatable (see [isLiquidatable](#liquidatable-accounts) function).

#### Comet

```solidity
function isBorrowCollateralized(address account) returns (bool)
```

* `account`: The account to examine collateralization.
* `RETURNS`:  Returns true if the account has enough liquidity for borrowing.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
bool isCollateralized = comet.isBorrowCollateralized(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const isCollateralized = await comet.methods.isBorrowCollateralized(0xAccount).call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const isCollateralized = await comet.callStatic.isBorrowCollateralized(0xAccount);
```

## Liquidation

Compound Comet borrowers need to consider the *borrow collateral factors* and the *liquidation collateral factors* in order to keep their account healthy and avoid liquidation.

The liquidation collateral factors are strictly greater than the borrow collateral factors. If a borrower violates the liquidation collateral factor requirements, their account is subject to liquidation. Examples of instances where this occurs are described below.

Collateral factors are stored as integers that represent decimal values scaled up by `10 ^ 18` in the Comet smart contract. For example, a value of `950000000000000000` represents a 95% collateral factor. Borrow and liquidation collateral factors can be fetched using the *[Get Asset Info](#get-asset-info)* function.

An account is subject to liquidation if its borrowed amount exceeds the limits set by the liquidation collateral factors. The three instances where this can occur are when borrower interest owed accrues beyond the limit, when the USD value of the collateral drops below supporting the open borrow, or when the USD value of the borrowed asset increases too much. If an underwater account violates the borrow collateral factors, but does not violate the liquidation collateral factors, it is not yet subject to liquidation.

Liquidation is the absorption of an underwater account into the protocol, triggered by the [Absorb](#absorb) function. The protocol seizes all of the account's collateral and repays its open borrow. The protocol can then attempt to sell some or all of the collateral to recover any reserves that covered liquidation. If any excess collateral is seized, the protocol will pay the excess back to the account in the base asset.

Any address can call the Absorb function. In exchange, the caller is compensated for the gas used in the transaction plus the fixed-amount absorb tip.

**TODO: [Equation for calculating the amount sent to the absorb caller?]**

### Absorb

This function can be called by any address to liquidate an underwater account. It transfers the account's debt to the protocol account, decreases cash reserves to repay the account's borrows, and adds the collateral to the protocol's own balance. In exchange, the caller of Absorb is compensated for the gas used in the transaction plus the fixed-amount absorb tip.

**TODO: [Insert equation for calculating the reward for calling absorb?]**

#### Comet

```solidity
function absorb(address absorber, address account)
```

```solidity
function absorb(address absorber, address[] accounts)
```

* `absorber`:  The account that is issued the absorb tip and gas reimbursement.
* `account`:  The underwater account that is to be liquidated.
* `accounts`:  An array of underwater accounts that are to be liquidated.
* `RETURN`: No return, reverts on error.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
comet.absorb(0xUnderwaterAddress);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
await comet.methods.absorb("0xUnderwaterAddress").send();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
await comet.absorb("0xUnderwaterAddress");
```

### Liquidatable Accounts

This function returns true if the account passed to it has negative liquidity based on the liquidation collateral factor. A return value of true indicates that the account is presently liquidatable.

#### Comet

```solidity
function isLiquidatable(address account) returns (bool)
```

* `account`: The account to examine liquidatability.
* `RETURNS`:  Returns true if the account is presently able to be liquidated.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
bool isLiquidatable = comet.isLiquidatable(0xAccount);
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const isLiquidatable = await comet.methods.isLiquidatable(0xAccount).call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const isLiquidatable = await comet.callStatic.isLiquidatable(0xAccount);
```

## Reserves

Reserves are a portion of historical interest set aside as cash which can be withdrawn or transferred through the protocol's governance. A portion of borrower interest accrues into the protocol, determined by the reserve factor. The Comet account [liquidation](#liquidation) process uses and also adds to protocol reserves.

### Get Reserves

This function returns the amount of protocol reserves for the base asset as an integer.

#### Comet

```solidity
function getReserves() returns (uint)
```

* `RETURNS`:  The amount of base asset stored as reserves in the protocol as an unsigned integer scaled up by 10 to the "decimals" integer in the asset's contract.

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

### Ask Price

In order to repay the borrows of absorbed accounts, the protocol needs to sell the seized collateral. The *Ask Price* is the price of the asset to be sold with a fixed discount (configured by governance). This function uses the price returned by the protocol's price feed.
[Insert formula for the Ask Price]

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
const askPrice = await comet.methods.quoteCollateral("0xERC20Address", 1000000).call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const askPrice = await comet.callStatic.quoteCollateral("0xERC20Address", 1000000);
```

### Liquidator Points

Presently there is no immeditate reward for accounts that trigger liquidations via the absorb function. The protocol keeps track of the successful executions of absorb by tallying liquidator "points" and gas the liquidator has spent. The idea of the points system is to eventually reward liquidators and compensate them for gas costs in the future via Compound governance.

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
const [ numAbsorbs, numAbsorbed, approxSpend ] = await comet.methods.liquidatorPoints("0xLiquidatorAddress").call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ numAbsorbs, numAbsorbed, approxSpend ] = await comet.callStatic.liquidatorPoints("0xLiquidatorAddress");
```

## Account Management

In addition to self-management, Compound Comet accounts can enable other addresses to have write permissions for their account. Account managers can supply collateral, withdraw collateral, or transfer collateral within the protocol on behalf of another account. This is possible only after an account has enabled permissions by using the Allow function.

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

This is a sparate version of the allow function that enables submission using an EIP-712 offline signature. For more details on how to create an offline signature, review [EIP-712](https://eips.ethereum.org/EIPS/eip-712).

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
* `nonce`: The contract state required to match the signature. This can be retrieved from the contract's public nonces mapping.
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

## Helper Functions

### Get Utilization

This method returns the current protocol utilization of the base asset. The formula for producing the utilization is:

`Utilization = TotalBorrows / TotalSupply`

#### Comet

```solidity
function getUtilization() returns (uint)
```

* `RETURNS`:  The current protocol utilization in USD as an unsigned integer, scaled up by `10 ^ 6`. E.g. `1000000000000000` is $1 billion USD.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint utilization = comet.getUtilization(); // example: 1000000000000000 (1 billion)
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
const [ totalSupplyAsset ] = await comet.methods.totalsCollateral("0xERC20Address").call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ totalSupplyAsset ] = await comet.callStatic.totalsCollateral("0xERC20Address");
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

### Base Balance

This method returns the current balance of base asset for a specified account in the protocol, including interest. If the account is presently borrowing or not supplying, it will return `0`.

#### Comet

```solidity
function balanceOf(address account) returns (uint104)
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
function borrowBalanceOf(address account) returns (uint104)
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

### Account Data

The protocol tracks data like the principal and indexes for each account that supplies and borrows. The data is stored in a mapping with the account address that points to a struct.

#### Comet

```solidity
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
const [ principal, baseTrackingIndex, baseTrackingAccrued, assetsIn ] = await comet.methods.userBasic("0xAccount").call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const [ principal, baseTrackingIndex, baseTrackingAccrued, assetsIn ] = await comet.callStatic.userBasic("0xAccount");
```

### Current Timestamp

This method returns the current timestamp from the protocol.

#### Comet

```solidity
function getNow() virtual public view returns (uint40)
```

* `RETURNS`: An integer of the current timestamp which is the EVM block timestamp.

#### Solidity

```solidity
Comet comet = Comet(0xCometAddress);
uint40 timestamp = comet.getNow();
```

#### Web3.js v1.5.x

```js
const comet = new web3.eth.Contract(abiJson, contractAddress);
const timestamp = await comet.methods.getNow().call();
```

#### Ethers.js v5.x

```js
const comet = new ethers.Contract(contractAddress, abiJson, provider);
const timestamp = await comet.callStatic.getNow();
```

### Get Asset Info

This method returns information about the specified asset.

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

The [Open Price Feed](https://compound.finance/docs/prices) accounts price data for the Compound protocol. The protocol uses it as a source of truth for asset prices. Prices are updated by [Chainlink Price Feeds](https://data.chain.link/). The codebase is hosted on [GitHub](https://github.com/compound-finance/open-oracle), and maintained by the community.

This function returns the price of an asset in USD.

#### Comet

```solidity
function getPrice(address asset) returns (uint)
```

* `asset`: The ERC-20 address of the asset being queried.
* `RETURNS`:  Returns the USD price with 6 decimal places as an unsigned integer scaled up by `10 ^ 6`. E.g. `5000000000` means that the asset's price is $5000 USD.

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

## Governance

Compound Comet is a decentralized protocol that is governed by holders of COMP. Governance allows the community to propose, vote, and implement changes through the administrative functions of the Comet protocol contract. For more information on the [governance](https://compound.finance/docs/governance) system see the governance section.
