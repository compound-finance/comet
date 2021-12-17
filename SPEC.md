---
title: Compound Comet Specification
tags: comet, v2.5, protocol, spec
output: pdf_document
margin-left: 3cm
linestretch: 1.3
header-includes:
- \usepackage[mathscr]{eucal}
- |
  ```{=latex}
  % header %
  ```
---
$$
  % preamble
  %
  % math
  \newcommand{\pluseq}{\mathrel{+}=}
  \newcommand{\subeq}{\mathrel{-}=}
  %
  % generic types
  \newcommand{\Config}[1]{\mathbb{#1}}
  \newcommand{\Storage}[1]{\mathscr{#1}}
  \newcommand{\Param}[1]{\mathsf{#1}}
  \newcommand{\var}[1]{\mathit{#1}}
  \newcommand{\SystemParam}[2]{#1_{#2}}
  \newcommand{\ContractCall}[4]{\mathbb{#1}(#2).\mathop{#3}(#4)}
  \newcommand{\Func}[2]{\mathop{#1}(#2)}
  %
  % system params
  \newcommand{\Msg}{\SystemParam{System}{Msg}}
  \newcommand{\Now}{\SystemParam{System}{Now}}
  \newcommand{\This}{\SystemParam{Contract}{This}}
  \newcommand{\Sender}{\SystemParam{Msg}{Sender}}
  \newcommand{\EVM}[1]{\SystemParam{EVM}{#1}}
  %
  % common params
  \newcommand{\Operator}{\Param{Operator}}
  \newcommand{\Account}{\Param{Account}}
  \newcommand{\Asset}{\Param{Asset}}
  \newcommand{\From}{\Param{From}}
  \newcommand{\To}{\Param{To}}
  \newcommand{\Src}{\Param{Src}}
  \newcommand{\Dst}{\Param{Dst}}
  \newcommand{\Amount}{\Param{Amount}}
  %
  % evm opcodes
  \newcommand{\GASLEFT}{\EVM{GASLEFT}}
  \newcommand{\BASEFEE}{\EVM{BASEFEE}}
  % common vars
  \newcommand{\txAmount}{\var{txAmount}}
  %
  % external contracts
  \newcommand{\transfer}[2]{\ContractCall{Erc20}{#1}{ transfer}{#2}}
  \newcommand{\transferFrom}[2]{\ContractCall{Erc20}{#1}{ transferFrom}{#2}}
  \newcommand{\balanceOf}[2]{\ContractCall{Erc20}{#1}{ balanceOf}{#2}}
  %
  % global funcs
  \newcommand{\HasPermission}[2]{\Func{HasPermission}{#1,\ #2}}
  \newcommand{\Accrue}{\Func{Accrue}{}}
  \newcommand{\GetReserves}{\Func{GetReserves}{}}
  \newcommand{\GetUtilization}{\Func{GetUtilization}{}}
  \newcommand{\GetSupplyRate}{\Func{GetSupplyRate}{}}
  \newcommand{\GetBorrowRate}{\Func{GetBorrowRate}{}}
  \newcommand{\GetPrice}[1]{\Func{GetPrice}{#1}}
  \newcommand{\UpdateBaseBalance}[3]{\Func{UpdateBaseBalance}{#1,\ #2,\ #3}}
  \newcommand{\IsBorrowCollateralized}[1]{\Func{IsBorrowCollateralized}{#1}}
  \newcommand{\IsLiquidatable}[1]{\Func{IsLiquidatable}{#1}}
  \newcommand{\RepayAndSupplyAmount}[2]{\Func{RepayAndSupplyAmount}{#1,\ #2}}
  \newcommand{\WithdrawAndBorrowAmount}[2]{\Func{WithdrawAndBorrowAmount}{#1,\ #2}}
  %
  % present value
  \newcommand{\PresentValue}[1]{\Func{PresentValue}{#1}}
  \newcommand{\PresentValueSupply}[1]{\Func{PresentValue_{Supply}}{#1}}
  \newcommand{\PresentValueBorrow}[1]{\Func{PresentValue_{Borrow}}{#1}}
  %
  % principal value
  \newcommand{\PrincipalValue}[1]{\Func{PrincipalValue}{#1}}
  \newcommand{\PrincipalValueSupply}[1]{\Func{PrincipalValue_{Supply}}{#1}}
  \newcommand{\PrincipalValueBorrow}[1]{\Func{PrincipalValue_{Borrow}}{#1}}
  %
  % complete funcs
  \newcommand{\CheckPerms}[2]{\HasPermission{#1}{#2}}
  % config
  \newcommand{\Governor}{\Config{Governor}}
  \newcommand{\PauseGuardian}{\Config{PauseGuardian}}
  \newcommand{\PriceOracle}{\Config{PriceOracle}}
  \newcommand{\BaseToken}{\Config{BaseToken}}
  \newcommand{\CollateralAssets}{\Config{CollateralAssets}}
  \newcommand{\BorrowCollateralFactor}[1]{\Config{BorrowCollateralFactor}_{#1}}
  \newcommand{\LiquidateCollateralFactor}[1]{\Config{LiquidateCollateralFactor}_{#1}}
  \newcommand{\LiquidationPenalty}[1]{\Config{LiquidationPenalty}_{#1}}
  \newcommand{\StoreFrontDiscountFactor}[1]{\Config{StoreFrontDiscountFactor}_{#1}}
  \newcommand{\TargetReserves}{\Config{TargetReserves}}
  \newcommand{\AbsorbTip}{\Config{AbsorbTip}}
  \newcommand{\AbsorbBaseGas}{\Config{AbsorbBaseGas}}
  \newcommand{\BorrowMin}{\Config{BorrowMin}}
  \newcommand{\SupplyCap}[1]{\Config{SupplyCap}_{#1}}
  \newcommand{\BaseTrackingSupplySpeed}{\Config{BaseTrackingSupplySpeed}}
  \newcommand{\BaseTrackingBorrowSpeed}{\Config{BaseTrackingBorrowSpeed}}
  \newcommand{\SupplyRateBase}{\Config{SupplyRateBase}}
  \newcommand{\SupplyRateSlope}{\Config{SupplyRateSlope}}
  \newcommand{\BorrowRateBase}{\Config{BorrowRateBase}}
  \newcommand{\BorrowRateSlope}{\Config{BorrowRateSlope}}
  \newcommand{\Kink}{\Config{Kink}}
  \newcommand{\InterestRateSlopeLow}{\Config{InterestRateSlopeLow}}
  \newcommand{\InterestRateSlopeHigh}{\Config{InterestRateSlopeHigh}}
  \newcommand{\InterestRateBase}{\Config{InterestRateBase}}
  \newcommand{\ReserveRate}{\Config{ReserveRate}}
  %
  % storage
  \newcommand{\TotalSupplyBase}{\Storage{TotalSupplyBase}}
  \newcommand{\TotalBorrowBase}{\Storage{TotalBorrowBase}}
  \newcommand{\LastAccrualTime}{\Storage{LastAccrualTime}}
  \newcommand{\BaseSupplyIndex}{\Storage{BaseSupplyIndex}}
  \newcommand{\BaseBorrowIndex}{\Storage{BaseBorrowIndex}}
  \newcommand{\TrackingSupplyIndex}{\Storage{TrackingSupplyIndex}}
  \newcommand{\TrackingBorrowIndex}{\Storage{TrackingBorrowIndex}}
  \newcommand{\PauseFlags}{\Storage{PauseFlags}}
  \newcommand{\UserPrincipal}[1]{\Storage{UserPrincipal}_{#1}}
  \newcommand{\UserBaseTrackingIndex}[1]{\Storage{UserBaseTrackingIndex}_{#1}}
  \newcommand{\UserBaseTrackingAccrued}[1]{\Storage{UserBaseTrackingAccrued}_{#1}}
  \newcommand{\UserAssets}[1]{\Storage{UserAssets}_{#1}}
  \newcommand{\TotalCollateral}[1]{\Storage{TotalCollateral}_{#1}}
  \newcommand{\CollateralTrackingIndex}[1]{\Storage{CollateralTrackingIndex}_{#1}}
  \newcommand{\IsPermitted}[2]{\Storage{IsPermitted}_{#1,\ #2}}
  \newcommand{\UserCollateral}[2]{\Storage{UserCollateral}_{#1,\ #2}}
  \newcommand{\UserCollateralTrackingIndex}[2]{\Storage{UserCollateralTrackingIndex}_{#1,\ #2}}
  \newcommand{\UserNonce}[1]{\Storage{UserNonce}_{#1}}
  % postamble
$$

# Compound Comet

## Overview
Given that most borrowing activity in DeFi today consists of supplying volatile crypto assets and borrowing a single borrowable base token, we aim to achieve greater capital efficiency (including gas costs) by building a specialized protocol which allows you to supply volatile assets, and borrow only a single (e.g. stable) coin.

#### Value Proposition

1. More capital efficiency (more dollars for same collateral*)
2. Optimized for common usage (crypto collateral, USDC** borrows)
3. Fine-grained access controls for delegating account management
4. Internalize liquidation / profits

\* Collateral here exclusively refers to an ERC-20 token (or a similar token standard for a different blockchain). The native token (e.g. Ether) must be wrapped as either WETH or LIDO to be used as collateral.

\*\* Base token refers to the single borrowable asset, e.g. USDC. We may also refer to this as the base token.

## Architecture

### Contracts

As the goal of Comet is to be highly optimized for a particular use case, we seek to minimize the number of contracts involved. The protocol is implemented primarily in a monolithic contract. We assume all math operations revert in the case of overflow or underflow. We assume all values are unsigned 32-byte integers unless otherwise specified.

### Prices :new: :male-cook:
The protocol will use a price oracle, similar to that of the Compound V2 protocol. Specifically, the price oracle should satisfy the following interface:

$getPrice(address) \mapsto uint256$

where the value returned in the price of the native value of the asset, such that:

$$
\forall \var{asset0}, \var{asset1} \in {({\CollateralAssets \cup \BaseToken})}^2,\\ \frac{\mathop{getPrice}(\var{asset0})}{\mathop{getPrice}(\var{asset1})} \varpropto  \frac{price_{\var{asset0}} \cdot 10^{\var{decimals}_{\var{asset0}}}}{price_{\var{asset1}} \cdot 10^{\var{decimals}_{\var{asset1}}}}
$$

Where $price$ and $decimals$ refer to a real-life approxmiation of the current price of an asset and decimals is the number of decimals for the native value of the token. Effectively, this is saying that the ratio of the price of any two assets must equal the real-life ratio of the assets, accounting for the token's decimals. Additionally, this does _not_ say that the price needs to be specifically denominated in USD or any other currency, so long as the prices are consistent.

* Note: in the future, we may wish that the price oracle implements: $getPrices(address[]) \mapsto uint256[]$, but this is not currently required for an oracle.

For Ethereum main-net, the oracle used in Compound v2 satisfies these constraints. For other deployment chains, a satisfactory oracle would need to be found or deployed.

### Interest Rates
Unlike Compound v2, where the supply rate is derived from the borrow rate and reserve factor, in Compound Comet the protocol has a distinct borrow and supply rate curve for the borrowed token. Separating the rate curves gives governance more fine-grained control over supply rates and reserves, the downside is that it requires twice as much work from governance to maintain. However, since Comet only supports borrowing and supply rates in the stable coin market, the management complexity is still less than v2.

### Balances, Principal and Indices
A multiplicative index can be calculated as:

$$Index_{T_1} = Index_{T_0} (T_1-T_0)$$

where $Index_{T}$ represents the interest index at time $T$, and $T_N$ represents the wall clock time (e.g. as a Unix epoch). Multiplicative indices are usually applied as $Balance_{T_1}=Balance_{T_0} \cdot \frac{Index_{T_1}}{Index_{T_0}}$. That is, the ratio of two indices is a multiplicative factor which correctly moves a balance forward in time with interest. This is the same method used in Compound v2 _C-Tokens_.

In Comet, interest-bearing balances are represented internally as _principal_ amounts. A principal, derived from a balance at time T, is a new balance, such that if you accrued interest from the beginning of time, that balance's current vaue, at time T, would equal the original given balance. That is, it is what a balance would have been at $T_0$ to be equal in value today. This principal value can be easily derived for a $Balance_{T_N}$ by taking $Principal = Balance_{T_N} \cdot \frac{Index_{T_0}}{Index_{T_N}}$. The alternative would be to store the tuple $(Balance_{T_N}, T_N)$, but we can save space by storing the singular _principal_. We sometimes refer to principals as day-zero balances, since they correspond to the balance as of the first index, $Index_{T_0}$.

Indices are always assumed to be unsigned integers, while balances are signed integers. This is in contrast to Compound v2 where both indices and balances were unsigned. However in v2, balances were separated into supply and borrow amounts, whereas here they are combined into a single signed number (and thus supply and borrow cannot be maintained at the same time, for an account balance of any asset).

### Factors

A _factor_ through this document refers to a fixed-digit decimal number. Specifically, a decimal number scaled by 1e18. These numbers should be treated as real numbers scaled down by 1e18. For example, the number 50% would be represented as $0.5e18$ and stored in binary as $0x4563918244f40000.$ In this specification, we may write constant factors as $1.5f$ to imply 1.5e18 as a factor.

\* Note: not to be confused with $CollateralFactor$ values, which may themselves, be stored as _factors_.

## Configuration Constants

Configuration constants are immutable constants on contract deployment. In the EVM, it thus costs nothing to read a configuration variable, but to change a constant, we require a new deployment of the contract. Note: in Solidity, arrays will need to be unwound (e.g. $\Config{ArrayEl0}$, $\Config{ArrayEl1}$, etc).

| Name       | Type | Description |
| ---------- | ---- | ----------- |
| $\Governor$ | $address$ | The governor of the protocol.
| $\PriceOracle$ | $address$   | Address of the [price oracle](#Prices). |
| $\BaseToken$ | $address$   | Address of the base token. |
| $\CollateralAssets$ | $address[]$ | The list of collateral asset addresses. |
| $\BorrowCollateralFactor{Asset}$ | $factor$ | Collateral factor for given asset required in order to initiate a borrow. |
| $\LiquidateCollateralFactor{Asset}$| $factor$ | Collateral factor for given asset used when performing liquidity checks. Greater than the $\BorrowCollateralFactor{Asset}$ to avoid excessive liquidation.
| $\LiquidationPenalty{Asset}$ | $factor$ | Fraction of collateral value received in borrow token when liquidated. |
| $\StoreFrontDiscountFactor{Asset}$ | $factor$ | Factor to multiply by when calculating the store-front collateral price. (e.g. a 2% discount would use a 0.98 factor) |
| $\TargetReserves$ | $uint$ | Minimum borrow token reserves which must be held before collateral is hodled. |
| $\AbsorbTip$ | $factor$ | Multipler on gas used to be given in base token to absorber :new: :male-cook: |
| $\AbsorbBaseGas$ | $uint$ | Base gas to repay absorber to cover transaction start-up fees and base unit transfer :new: :male-cook: |
| $\BorrowMin$ | $uint$ | The minimum borrow amount required to enter into a borrow position. |
| $\SupplyCap{Asset}$ | $uint$ | Maximum supply of asset which is allowed to be supplied. |
| $\BaseTrackingSupplySpeed$ | $factor$ | Speed to track per second for suppliers. |
| $\BaseTrackingBorrowSpeed$ | $factor$ | Speed to track per second for borrowers. |
| $\Kink$ | $factor$ | Point in the supply and borrow rates separating the low interest rate slope and the high interest rate slope|
| $\InterestRateSlopeLow$ | $factor$ | Interest rate slope applied when utilization is below kink. |
| $\InterestRateSlopeHigh$ | $factor$ | Interest rate slope applied when utilization is above kink. |
| $\InterestRateBase$ | $factor$ | The base interest rate. |
| $\ReserveRate$ | $factor$ | The rate of total interest paid that goes into reserves. |

## Storage

| $\TotalSupplyBase$ :green_heart: | $uint72$ | Total amount of base token principal which the protocol owes to suppliers. |
| $\TotalBorrowBase$ :yellow_heart: | $uint72$ | Total amount of base token principal which borrowers owe to the protocol. |
| $\LastAccrualTime$ :green_heart::yellow_heart: | $uint40$ | Timestamp of last interest accrual.<br/><br/>_Note_: Split storage between 2 slots with 24-bits available in :yellow_heart: and 20-bits availbile in :green_heart:. |
| $\BaseSupplyIndex$ :green_heart: | $uint64$ | Interest index for base token supply principal. |
| $\BaseBorrowIndex$ :yellow_heart: | $uint64$ | Interest index for base token borrow principal. |
| $\TrackingSupplyIndex$  :green_heart: | $uint96$ | Index tracking total protocol participation for supply. |
| $\TrackingBorrowIndex$ :yellow_heart: | $uint96$ | Index tracking the total protocol partipcation for borrows. |
| $\PauseFlags$ :green_heart: | $uint8$ | Flags for per function pause state.
| $\IsPermitted{Owner}{Manager}$ :orange_heart: | $bool$ | Whether or not the $Manager$ has permission to manage the $Owner$ account. |
| $\UserPrincipal{Account}$ :purple_heart: | $int72$ | Amount of stable coin principal which is owed to a given account (+) or by it (-). |
| $\UserBaseTrackingIndex{Account}$ :purple_heart: | $uint96$ | The index tracking user participation for a given account. |
| $\UserBaseTrackingAccrued{Account}$ :purple_heart: | $uint48$ | Total participation tracking index previously earned by an account.
| $\UserAssets{Account}$ :purple_heart: :new: | $uint16$ | Bit vector mapping collateral assets the user has a non-zero balance in. 
| $\TotalCollateral{Asset}$ :blue_heart: | $uint128$ | Total amount of given collateral asset which the protocol owes to borrowers. |
| $\CollateralTrackingIndex{Asset}$ :blue_heart: | $uint128$ | The global tracking index for an asset.  [TBD] |
| $\UserCollateral{Asset}{Account}$ :red_heart: | $uint128$ | Amount of given collateral asset owed to a given account. |
| $\UserCollateralTrackingIndex{Asset}{Account}$ :red_heart: | $uint128$ | The collateral tracking index for an asset as of the last balance interaction by an account. [TBD] |
| $\UserNonce{Account}$ :new: | $uint$ | The next expected nonce for a given account.

## Constructor

### Constructor()

* **Write** $\LastAccrualTime = \Now$
* **Write** $\BaseSupplyIndex = 1.0f$
* **Write** $\BaseBorrowIndex = 1.0f$
* **Write** $\TrackingSupplyIndex = 1.0f$
* **Write** $\TrackingBorrowIndex = 1.0f$

## Account Functions

#### Allow(Manager, IsAllowed) [External]
Allow or disallow another address to supply, withdraw, or transfer from the $\Sender$ address.

* **Call** $\mathop{Allow}(\Sender, Manager, IsAllowed)$

#### Allow(*Owner*, Manager, IsAllowed) [Internal]
Allow or disallow another address to supply, withdraw, or transfer from the given Sender address.

* **Write** $\IsPermitted{Owner}{Manager} = \Param{IsAllowed}$

#### AllowBySig(Manager, IsAllowed, Nonce, Expiry, Signature) :new:
Allow or disallow another address to supply, withdraw, or transfer from the signer of an [EIP-712](https://eips.ethereum.org/EIPS/eip-712) encoded message.

* Recover $Signatory$ from EIP-712 encoded $(\Param{Manager}, \Param{IsAllowed}, \Param{Nonce}, \Param{Expiry})$ via $\Param{Signature}$
* Require $Signatory$ is valid
* Require $Nonce = \UserNonce{Signatory}++$
* Require $\Now \leq Expiry$
* **Call** $\mathop{Allow}(Signatory, Manager, IsAllowed)$

#### Supply(Asset, Amount) [External]
  * **Call** $\mathop{Supply}(\Sender, \Asset, \Amount)$

#### Supply(Dst, Asset, Amount) [External]
  * **Call** $\mathop{Supply}(\Sender, \Dst, \Asset, \Amount)$

#### Supply(From, Dst, Asset, Amount) [External]

  * **Call** $\mathop{Supply}(\Sender, \From, \Dst, \Asset, \Amount)$

#### Supply(*Operator*, From, Dst, Asset, Amount) [Internal]

  * **When** $\Asset = \BaseToken$:
    * **Call** $\mathop{SupplyBase}(Operator, \From, \Dst, \Amount)$
  * **Else**
    * **Call** $\mathop{SupplyCollateral}(Operator, \From, \Dst, \Asset, \Amount)$

#### SupplyCollateral(Operator, From, Dst, Asset, Amount) [Internal]
Supplies a collateral token to the protocol, which the account can later borrow against.

* **Require** $\CheckPerms{\From}{\Operator}$
* **External Trx** $\transferFrom{\Asset}{\From, \This, \Amount}$
  * **Let** $\txAmount$ be the actual amount transferred less any fees.
* **Read** $dstCollateral = \UserCollateral{\Asset}{\Dst}$
* Let $dstCollateralNew = dstCollateral + txAmount$
* **Write** $\TotalCollateral{\Asset} \pluseq \txAmount$
* **Write** $\UserCollateral{\Asset}{\Dst} = dstCollateralNew$
* **Call** $\mathop{UpdateUserAssets}(\Dst, \Asset, dstCollateral, dstCollateralNew)$
* **Require** $\TotalCollateral{\Asset} \leq \SupplyCap{\Asset}$

#### SupplyBase(Operator, From, Dst, Amount) [Internal]
Transfers in borrow token pegged to the user's account. This will repay any outstanding borrows before adding to a user's supply. If the user has a positive supply balance, their accont will receive yield along the supply curve.

* **Require** $\CheckPerms{\From}{\Operator}$
* **External Trx** $\transferFrom{\Asset}{\From, \This, \Amount}$
  * **Let** $\txAmount$ be the actual amount transferred less any fees.
* **Call** $\Accrue$
* **Read** $\var{dstPrincipal}=\UserPrincipal{\Dst}$
* **Let** $\var{dstBalance} = \PresentValue{\var{dstPrincipal}}$
* **Read** $\var{totalSupplyBaseBalance} = \PresentValueSupply{\TotalSupplyBase}$
* **Read** $\var{totalBorrowBaseBalance} = \PresentValueBorrow{\TotalBorrowBase}$
* **Let** $\var{repaySupply} = \RepayAndSupplyAmount{\var{dstBalance}}{\txAmount}$
* **Let** $\var{dstBalance'} = \var{dstBalance} + \txAmount$
* **Let** $\var{totalSupplyBaseBalance'} = \var{totalSupplyBaseBalance} + \var{repaySupply_{supply}}$
* **Let** $\var{totalBorrowBaseBalance'} = \var{totalBorrowBaseBalance} - \var{repaySupply_{repay}}$
* **Call** $\UpdateBaseBalance{\Dst}{\var{dstPrincipal}}{\PrincipalValue{\var{dstBalance'}}}$
* **Write** $\TotalSupplyBase = \PrincipalValueSupply{\var{totalSupplyBaseBalance'}}$
* **Write** $\TotalBorrowBase = \PrincipalValueBorrow{\var{totalBorrowBaseBalance'}}$

#### Transfer(Dst, Asset, Amount) [External]
* **Call** $\mathop{Transfer}(\Sender, \Dst, \Asset, \Amount)$

#### Transfer(Src, Dst, Asset, Amount) [External]
* **Call** $\mathop{Transfer}(\Sender, \Src, \Dst, \Asset, \Amount)$

#### Transfer(*Operator*, Src, Dst, Asset, Amount) [Internal]

* **When** $\Asset = \BaseToken$:
    * **Call** $\mathop{TransferBase}(Operator, \Src, \Dst, \Amount)$
* **Else**
    * **Call** $\mathop{TransferCollateral}(Operator, \Src, \Dst, \Asset, \Amount)$

#### TransferCollateral(Operator, Src, Dst, Asset, Amount) [Internal]
Transfers collateral between users. Reverts if the Src user would have negative liquidity after the transfer. 

* **Require** $\CheckPerms{\Src}{\Operator}$
* **Read** $srcCollateral = \UserCollateral{\Asset}{\Src}$
* **Read** $dstCollateral = \UserCollateral{\Asset}{\Dst}$
* Let $srcCollateralNew = srcCollateral - txAmount$
* Let $dstCollateralNew = dstCollateral + txAmount$
* **Write** $\UserCollateral{\Asset}{\Src} = srcCollateralNew$
* **Write** $\UserCollateral{\Asset}{\Dst} = dstCollateralNew$
* **Call** $\mathop{UpdateUserAssets}(\Src, \Asset, srcCollateral, srcCollateralNew)$
* **Call** $\mathop{UpdateUserAssets}(\Dst, \Asset, dstCollateral, dstCollateralNew)$
* **Require** $\IsBorrowCollateralized{\Src}$
  * _Note_: We don't need to accrue interest since $Borrow CF < Liquidation CF$ covers small changes

#### TransferBase(Operator, Src, Dst, Amount) [Internal]
Transfers base token between accounts. Reverts if $\Src$ account would have negative liquidity after the transfer. 

* **Require** $\CheckPerms{\Src}{\Operator}$
* **Call** $\Accrue$
* **Read** $\var{srcPrincipal} = \UserPrincipal{\Src}$
* **Read** $\var{dstPrincipal} = \UserPrincipal{\Dst}$
* **Let** $\var{srcBalance} = \PresentValue{\var{srcPrincipal}}$
* **Let** $\var{dstBalance} = \PresentValue{\var{dstPrincipal}}$
* **Read** $\var{totalSupplyBaseBalance} = \PresentValueSupply{\TotalSupplyBase}$
* **Read** $\var{totalBorrowBaseBalance} = \PresentValueBorrow{\TotalBorrowBase}$
* **Let** $\var{withdrawBorrow} = \WithdrawAndBorrowAmount{\var{srcBalance}}{\Amount}$
* **Let** $\var{repaySupply} = \RepayAndSupplyAmount{\var{dstBalance}}{\Amount}$
* **Let** $\var{srcBalance'} = \var{srcBalance} - \Amount$
* **Let** $\var{dstBalance'} = \var{dstBalance} + \Amount$
* **Let** $\var{totalSupplyBaseBalance'} = \var{totalSupplyBaseBalance} + \var{repaySupply_{supply}} - \var{withdrawBorrow_{withdraw}}$
* **Let** $\var{totalBorrowBaseBalance'} = \var{totalBorrowBaseBalance} + \var{withdrawBorrow_{borrow}} - \var{repaySupply_{repay}}$
* **Call** $\UpdateBaseBalance{\Src}{\var{srcPrincipal}}{\PrincipalValue{\var{srcBalance'}}}$
* **Call** $\UpdateBaseBalance{\Dst}{\var{dstPrincipal}}{\PrincipalValue{\var{dstBalance'}}}$
* **Write** $\TotalSupplyBase = \PrincipalValueSupply{\var{totalSupplyBaseBalance'}}$
* **Write** $\TotalBorrowBase = \PrincipalValueBorrow{\var{totalBorrowBaseBalance'}}$
* **If** $\var{srcBalance'} < 0$
   * **Require** $|\var{srcBalance'}| \geq \BorrowMin$
   * **Require** $\IsBorrowCollateralized{\Src}$

#### Withdraw(Asset, Amount) [External] 
* **Call** $\mathop{Withdraw}(\Sender, \Asset, \Amount)$

#### Withdraw(To, Asset, Amount) [External]
* **Call** $\mathop{Withdraw}(\Sender, \To, \Asset, \Amount)$

#### Withdraw(Src, To, Asset, Amount) [External]
* **Call** $\mathop{Withdraw}(\Sender, \Src, \To, \Asset, \Amount)$

#### Withdraw(*Operator*, Src, To, Asset, Amount) [Internal]
* **When** $\Asset = \BaseToken$:
    * **Call** $\mathop{WithdrawBase}(Operator, \Src, \To, \Amount)$
* **Else**
    * **Call** $\mathop{WithdrawCollateral}(Operator, \Src, \To, \Asset, \Amount)$

#### WithdrawCollateral(Operator, Src, To, Asset, Amount) [Internal]
Transfers out collateral from the $\Sender$ account to the $\To$ account. Reverts if the caller would have negative liquidity after withdrawal.

* **Require** $\CheckPerms{\Src}{\Operator}$
* **Read** $srcCollateral = \UserCollateral{\Asset}{\Src}$
* Let $srcCollateralNew = srcCollateral - Amount$
* **Write** $\TotalCollateral{\Asset} \subeq \Amount$
* **Write** $\UserCollateral{\Asset}{\Src} = srcCollateralNew$
* **Call** $\mathop{UpdateUserAssets}(\Src, \Asset, srcCollateral, srcCollateralNew)$
* **Require** $\IsBorrowCollateralized{\Src}$
* **External Trx** $\transfer{\Asset}{\To, \Amount}$

#### WithdrawBase(Operator, Src, To, Amount) [Internal]
Transfers out base token from the $\Sender$ account to the $\To$ account. Reverts if the caller would have negative liquidity after withdrawal.

* **Require** $\CheckPerms{\Src}{\Operator}$
* **Call** $\Accrue$
* **Read** $\var{srcPrincipal} = \UserPrincipal{\Src}$
* **Let** $\var{srcBalance} = \PresentValue{\var{srcPrincipal}}$
* **Read** $\var{totalSupplyBaseBalance} = \PresentValueSupply{\TotalSupplyBase}$
* **Read** $\var{totalBorrowBaseBalance} = \PresentValueBorrow{\TotalBorrowBase}$
* **Let** $\var{withdrawBorrow} = \WithdrawAndBorrowAmount{\var{srcBalance}}{\Amount}$
* **Let** $\var{srcBalance'} = \var{srcBalance} - \Amount$
* **Let** $\var{totalSupplyBaseBalance'} = \var{totalSupplyBaseBalance} - \var{withdrawBorrow_{withdraw}}$
* **Let** $\var{totalBorrowBaseBalance'} = \var{totalBorrowBaseBalance} + \var{withdrawBorrow_{borrow}}$
* **Call** $\UpdateBaseBalance{\Src}{\var{srcPrincipal}}{\PrincipalValue{\var{srcBalance'}}}$
* **Write** $\TotalSupplyBase = \PrincipalValueSupply{\var{totalSupplyBaseBalance'}}$
* **Write** $\TotalBorrowBase = \PrincipalValueBorrow{\var{totalBorrowBaseBalance'}}$
* **If** $\var{srcBalance'} < 0$
  * **Require** $|\var{srcBalance'}| \geq \BorrowMin$
  * **Require** $\IsBorrowCollateralized{\Src}$
* **External Trx** $\transfer{\BaseToken}{\To, \Amount}$

## Interest and Tracking Functions

#### Accrue() [Internal]
Accrue interest in base token supply and borrows. This function also tracks participation in the protocol.

* **Read** $\var{timeElapsed} = \Now - \LastAccrualTime$
* **When** $\var{timeElapsed} > 0$:
  * **Write** $\BaseSupplyIndex \pluseq \BaseSupplyIndex \cdot \GetSupplyRate \cdot \var{timeElapsed}$
  * **Write** $\BaseBorrowIndex \pluseq \BaseBorrowIndex \cdot \GetBorrowRate \cdot \var{timeElapsed}$
  * **Write** $\TrackingSupplyIndex \pluseq \frac{\BaseTrackingSupplySpeed}{\TotalSupplyBase} \cdot \var{timeElapsed}$
  * **Write** $\TrackingBorrowIndex \pluseq \frac{\BaseTrackingBorrowSpeed}{\TotalBorrowBase} \cdot \var{timeElapsed}$
  * **Write** $\LastAccrualTime = \Now$

#### UpdateBaseBalance(Account, InitialUserBalance, FinalUserBalance) [Internal]
Write updated balance to store and tracking participation.

* **When** $\Param{InitialUserBalance} \geq 0$:
  * **Read** $\var{indexDelta} = \TrackingSupplyIndex - \UserBaseTrackingIndex{\Account}$
* **Otherwise**:
  * **Read** $\var{indexDelta} = \TrackingBorrowIndex - \UserBaseTrackingIndex{\Account}$
* **When** $\Param{FinalUserBalance} \geq 0$:
  * **Write** $\UserBaseTrackingIndex{\Account} = \TrackingSupplyIndex$
* **Otherwise**:
  * **Write** $\UserBaseTrackingIndex{\Account} = \TrackingBorrowIndex$
* **Write** $\UserBaseTrackingAccrued{Account} \pluseq \Param{InitialUserBalance} \cdot \var{indexDelta}$
* **Write** $\UserPrincipal{Account} = \var{FinalUserBalance}$

#### UpdateAssetsIn(Account, Asset, InitialUserBalance, FinalUserBalance) [Internal] :new:
Update the "assets in" for an account based on the initial final collateral balances for an asset.

* If $InitialUserBalance = 0$ and $FinalUserBalance \neq 0$
    * **Read** $assetOffset = \mathop{GetAssetOffset}(\Asset)$
    * **Write** $UserAssets{Account}\ \mathrel{|}=\ (1 << assetOffset)$
        * Set the bit for the asset
* Else if $InitialUserBalance \neq 0$ and $FinalUserBalance = 0$
    * **Read** $assetOffset = GetAssetOffset(Asset)$
    * **Write** $UserAssets{Account}\ \mathrel{\&}=\ \lnot (1 << assetOffset)$
        * Clear the bit for the asset


#### GetSupplyRate(): factor [External]
Return the current supply rate.

  * **Let** $\var{utilization} = \GetUtilization$
  * **Let** $\var{totalSupply} = \PresentValue{\TotalSupplyBase}$
  * **Let** $\var{totalBorrow} = \PresentValue{\TotalBorrowBase}$  
  * If $\var{utilization} \leq \Kink$
      * **Return** $(\InterestRateBase + \InterestRateSlopeLow \cdot \var{utilization}) \cdot \frac{\var{totalBorrow}}{\var{totalSupply}}(1 - \ReserveRate)$
  * Else if $\var{utilization} > \Kink$
      * **Return $(\InterestRateBase + \InterestRateSlopeLow \cdot \Kink + \InterestRateSlopeHigh \cdot (\var{utilization} - \Kink)) \cdot \frac{\var{totalBorrow}}{\var{totalSupply}}(1 - \ReserveRate)$**

#### GetBorrowRate(): factor [External] 
Return the current borrow rate.

  * **Let** $\var{utilization} = \GetUtilization$
  * If $\var{utilization} \leq \Kink$
      * **Return $\InterestRateBase + \InterestRateSlopeLow \times \var{utilization}$**
  * Else if $\var{utilization} > \Kink$
      * **Return $\InterestRateBase + \InterestRateSlopeLow \times \Kink + \InterestRateSlopeHigh \times (\var{utilization} - \Kink)$**

#### GetUtilization(): factor [External] 
Returns the current protocol utilization.

  * **Read** $\var{totalSupply} = \PresentValue{\TotalSupplyBase}$
  * **Read** $\var{totalBorrows} = \PresentValue{\TotalBorrowBase}$
  * **When** $\var{totalSupply} = 0$:
    * **Return** $0$
  * **Otherwise**
    * **Return** $\var{totalBorrows} \over \var{totalSupply}$

## Liquidation Functions

#### AbsorbInternal(To, Account) [Internal]
Transfer user's debt to protocol accounts, decreasing cash reserves and adding collateral to the protocol's own balance. The caller is given an absorption incentive.

* **Require** $\IsLiquidatable{\Account}$
* **Read** $\var{acctPrincipal}=\UserPrincipal{\Account}$
* **Read** $assetsIn = \UserAssets{\Account}$
* **Let** $\var{basePrice} = \GetPrice{\BaseToken}$
* **Let** $\var{accountBalance} = \PresentValue{\var{accountPrincipal}}$
* Initialize $\var{accountBalance'} = \var{accountBalance}$
* For $\var{asset} \in \mathop{GetAssetsList}(assetsIn)$ 
  * **Read** $\var{seizeAmount} = \UserCollateral{\var{asset}}{\Account}$
  * **If** $\var{seizeAmount} > 0$:
    * **Write** $\UserCollateral{\var{asset}}{\Account} = 0$
    * **Write** $\UserCollateral{\var{asset}}{\This} \pluseq \var{seizeAmount}$
    * $\var{accountBalance'} \pluseq \var{seizeAmount} \cdot \GetPrice{\var{asset}} \cdot \LiquidationPenalty{\var{asset}}$
* Note:
    * **Log** $\var{deficitToReserves} = |\mathop{min}(\var{accountBalance'}, 0)|$
    * **Log** $\var{debtRepaidByReserves} = \var{accountBalance' - accountBalance}$
* **Let** $\var{accountBalance'} = { \mathop{max}(\var{accountBalance'}, 0) \over \var{basePrice} }$
* **Let** $accountPrincipal' = \PrincipalValue{\var{accountBalance'}}$
* **Call** $\UpdateBaseBalance{\Account}{\var{accountPrincipal}}{accountPrincipal'}$
* **Write** $\TotalSupplyBase \pluseq \PrincipalValueSupply{\var{accountBalance'}}$
* **Write** $\TotalBorrowBase \subeq \PrincipalValueBorrow{|\var{accountBalance}|}$
  * **Note**: We've added supply and decreased borrows. These both act to decrease reserves. The PCV of the protocol, however, may offset this by the collateral collected (except in cases of underwater accounts or if the collateral is not sold in a timely manner).

#### Absorb(To, Accounts) [External]
Absorb multiple accounts at once.

* **Let** $\var{startGas} = \GASLEFT$ :new: :male-cook:
* **For** $\var{account} \in \Param{Accounts}$:
  * **Call** $\mathop{AbsorbInternal}(\To, \var{account})$
* **Let** $\var{gasUsed} = gasStart - \GASLEFT + \AbsorbBaseGas$ :new: :male-cook:
* **Let** $\var{absorptionIncentive} = \var{gasUsed} \cdot (\BASEFEE + \AbsorbTip)$
* **External Trx** $\transfer{\BaseToken}{\To, \var{absorptionIncentive}}$
  
#### Absorb(To, Account) [External]
Absorb a single account.

* **Call** $\mathop{Absorb}(\Param{To}, [\Param{Account}])$

#### AskPrice(Asset, Amount) [External]
Calculate the store-front price for a given amount of collateral for sale. Does not check if the quantity is actually available for sale.

* Return $\GetPrice{\Asset} \cdot \StoreFrontDiscountFactor{\Asset}$

#### BuyCollateral(Asset, MinCollateralAmount, BaseAmount, Recipient)
Buy collateral from the protocol using base tokens, increasing reserves. A minimum collateral amount should be specified to indicate the maximum slippage acceptable for the buyer.

Note: we choose to implement a simple auction strategy which seemed to do well in simulations, this is a likely point for experimentation within the protocol. 

* **When** $\GetReserves < \TargetReserves$:
  * **Read** $\var{collateralAmount} = {\Param{BaseAmount} \div AskPrice(Asset)}$
  * **Require** $\var{collateralAmount} \geq MinCollateralAmount$
  * **External Trx** $\transferFrom{\BaseToken}{\Sender, \This, \Param{BaseAmount}}$
  * **Call** $WithdrawCollateral(\This, \This, Recipient, Asset, collateralAmount)$

## Reserves Functions

#### _WithdrawReserves(To, Amount) [Internal]
Withdraw reserves from the protocol to another account. 

* **Require** $\Sender = \Governor$
* **External Trx** $\transfer{\BaseToken}{\To}{\Amount}$

#### GetReserves(): int [External]
* **External Call** $\var{thisBalance} = \balanceOf{\BaseToken}{\This}$
* **Return** $\var{thisBalance} - \PresentValueSupply{\TotalSupplyBase} + \PresentValueBorrow{\TotalBorrowBase}$

#### pcv(): int [External View] :new: :male-cook:
* **Let** $\var{pcv} = \GetReserves$
* **For** $\var{asset} \in \CollateralAssets$
  * **Let** $\var{price} = \GetPrice{\var{asset}}$
  * **Let** $\var{balance} = \UserCollateral{\var{asset}}{\This}$
  * **Let** $\var{pcv} \pluseq \var{price} \cdot \var{balance}$
* **Return** $\var{pcv}$

## Pause Guardian Functions


#### Pause(SupplyPaused, TransferPaused, WithdrawPaused, AbsorbPaused, BuyPaused) [External]
Pause/Unpause the indicated functions. 
* **Require** $\Sender = \Governor || \PauseGuardian$
* **Write** $$\PauseFlags = 0 \\ \mathbin{|} (SupplyPaused \ll PauseSupplyOffset) \\ \mathbin{|} (TransferPaused \ll PauseTransferOffset)  \\ \mathbin{|} (WithdrawPaused \ll PauseWithdrawOffset) \\ \mathbin{|} (AbsorbPaused \ll PauseAbsorbOffset)  \\ \mathbin{|} (BuyPaused \ll PauseBuyOffset)$$

#### IsSupplyPaused(): bool [Public]
Returns true if supply is paused for all markets
* **Read** $isPaused = \PauseFlags \mathbin{\&} (1 \ll PauseSupplyOffset)$
* **Return** $isPaused$

#### IsTransferPaused(): bool [Public]
Returns true if transfer is paused for all markets
* **Read** $isPaused = \PauseFlags \mathbin{\&} (1 \ll PauseTransferOffset)$
* **Return** $isPaused$

#### IsWithdrawPaused(): bool [Public]
Returns true if withdraw is paused for all markets
* **Read** $isPaused = \PauseFlags \mathbin{\&} (1 \ll PauseWithdrawOffset)$
* **Return** $isPaused$

#### IsAbsorbPaused(): bool [Public]
Returns true if absorb is paused for all markets
* **Read** $isPaused = \PauseFlags \mathbin{\&} (1 \ll PauseAbsorbOffset)$
* **Return** $isPaused$

#### IsBuyPaused(): bool [Public]
Returns true if buy is paused for all markets
* **Read** $isPaused = \PauseFlags \mathbin{\&} (1 \ll PauseBuyOffset)$
* **Return** $isPaused$

## Helper Functions

#### IsBorrowCollateralized(Account): bool [External]
Returns true if the account has non-negative liquidity using the borrow collateral factors.

* **Read** $assetsIn = \UserAssets{\Account}$
* **Read** $\var{liquidity} = \GetPrice{\BaseToken} \times \PresentValue{\UserPrincipal{\Account}}$
* For $\var{asset} \in \mathop{GetAssetsList}(assetsIn)$
    * **If** $\var{liquidity} \geq 0$
        * **Return** $true$
    * $\var{liquidity} \pluseq \UserCollateral{\var{asset}}{\Account} \cdot \GetPrice{\Asset} \cdot \BorrowCollateralFactor{\Asset}$
* **Return** $\var{liquidity} \geq 0$

#### IsLiquidatable(Account): bool [External]
Returns true if the account has negative liquidity using the liquidation collateral factors.

* **Read** $assetsIn = \UserAssets{\Account}$
* **Read** $\var{liquidity} = \GetPrice{\BaseToken} \times \PresentValue{\UserPrincipal{\Account}}$
* For $\var{asset} \in \mathop{GetAssetsList}(assetsIn)$
    * **If** $\var{liquidity} \geq 0$
        * **Return** $false$
    * $\var{liquidity} \pluseq \UserCollateral{\var{asset}}{\Account} \cdot \GetPrice{\Asset} \cdot \LiquidateCollateralFactor{\Asset}$
* **Return** $\var{liquidity} < 0$

#### GetAssetOffset(Asset): uint8
Return the offset of the asset within the list (index into bit vector). :new: :male-cook:

* **For** ($\var{asset}, \var{index}) \in \CollateralAssets$
  * **When** $\var{asset} = \Param{Asset}$:
    * **Return** $\var{index}$
* **Revert** Asset Not Found

#### GetAssetList(AssetsIn): Asset[]
Return the list of asset addresses, given a bit vector of 'assets in'. :new: :male-cook:

* **Let** $\var{assets} = []$
* **For** $\var{index} \in 0..{|\CollateralAssets|}$
  * **When** $(1 \ll \var{index}) \land \Param{AssetsIn} \neq 0$:
    * **Append** ${\CollateralAssets}_\var{index}$ to $\var{assets}$
* **Return** $\var{assets}$

#### GetPrice(Asset): factor [External]
Get the price of an asset

#### HasPermission(address Owner, address Manager): bool [Internal]
* **Return** $\Param{Owner} = \Param{Manager} \lor \IsPermitted{\Param{Owner}}{\Param{Manager}}$

#### PrincipalValue(int PresentValue): int [Internal]
Return the positive principal supply balance if positive or the negative borrow balance if negative.

* **If** $\Param{PresentValue} \geq 0$:
  * **Return** $\PrincipalValueSupply{\Param{PresentValue}}$
* **Else**:
  * **Return** $\PrincipalValueBorrow{\Param{PresentValue}}$

#### PrincipalValue<sub>Supply</sub>(uint PresentValue): uint [Internal]
Return the amount projected backward by the supply index.
* **Read and Return** $\frac{\Param{PresentValue}}{\BaseSupplyIndex}$

#### PrincipalValue<sub>Borrow</sub>(uint PresentValue): uint [Internal]
Return the amount projected backward by the borrow index.

* **Read and Return** $\frac{\Param{PresentValue}}{\BaseBorrowIndex}$

#### PresentValue(int PrincipalValue): int [Internal]
Return the positive present supply balance if positive or the negative borrow balance if negative.

* **If** $\Param{PrincipalValue} \geq 0$:
  * **Return** $\PresentValueSupply{\Param{PrincipalValue}}$
* **Else**:
  * **Return** $\PresentValueBorrow{\Param{PrincipalValue}}$

#### PresentValue<sub>Supply</sub>(uint PrincipalValue): uint [Internal]
Return the principal amount projected forward by the supply index.

* **Read and Return** $\Param{PrincipalValue} \cdot \BaseSupplyIndex$

#### PresentValue<sub>Borrow</sub>(uint PrincipalValue): uint [Internal]
Return the principal amount projected forward by the borrow index.

* **Read and Return** $\Param{PrincipalValue} \cdot \BaseBorrowIndex$

#### RepayAndSupplyAmount(int Balance, uint Amount): (uint, uint) [Internal]

* **Let** $\var{repayAmount} = max(min(-\Param{Balance}, \Amount), 0)$
* **Let** $\var{supplyAmount} = \Amount - \var{repayAmount}$
* **Return** $\{\var{repay}=\var{repayAmount}, \var{supply}=\var{supplyAmount}\}$

#### WithdrawAndBorrowAmount(int Balance, uint Amount): (uint, uint) [Internal]

* **Let** $\var{withdrawAmount} = max(min(\Param{Balance}, \Amount), 0)$
* **Let** $\var{borrowAmount} = \Amount - \var{withdrawAmount}$
* **Return** $\{\var{withdraw}=\var{withdrawAmount}, \var{borrow}=\var{borrowAmount}\}$

## Liquidation
When an account goes underwater, its position can be absorbed into the protocol account, buying all the collateral belonging to the position in exchange for paying down their debt. The protocol then attempts to sell off the collateral in order to recover reserves which have been paid out to accounts in this way.

## Tracking
The protocol tracks participation in markets and accrues that to each account. This allows external contracts to confidently pull information about how long an account has participated in the Compound Protocol and how much value that account has provided to the protocol, in general.

## Interest Rate Calculations
The aim is to support two kinked interest models for supply and borrow that allow for a fixed reserve factor at each point of utilization. The following section derives a mathematical formula to achieve this goal.

A spreadsheet of the interest rate model can be found $\href{https://docs.google.com/spreadsheets/d/1G3BWcFPEQYnH-IrHHye5oA0oFIP0Jyj7pybdpMuDOuI}{\textrm{here}}$.

### Formula derivation

Start with the invariant, where $\var{S}=total \space supplies$, $\var{B}=total \space borrows$, $\var{r_S}=supply \space rate$, $\var{r_B}=borrow \space rate$, $\var{r_R}=reserve \space rate$:

$$
\var{B}\var{r_B} - \var{S}\var{r_S} = \var{r_R}\var{B}\var{r_B}
$$

In words, this states that the total reserves accrued is equals to the difference between total borrow interest and total supply interest.

Knowing $\var{r_R}$ is a constant, we can isolate it on one side:

$$
1-\frac{\var{S}\var{r_S}}{\var{B}\var{r_B}}=\var{r_R}
$$

$$
\frac{\var{S}\var{r_S}}{\var{B}\var{r_B}}=1-\var{r_R}
$$

Since the RHS is a constant, we need to find a way to make $\frac{\var{S}\var{r_S}}{\var{B}\var{r_B}}$ a constant as well. Since $\var{S}$ and $\var{B}$ are both variables, this can only be done by having $\var{r_S}$ be a product of $\var{B}$ and $\var{r_B}$ a product of $\var{S}$. We can normalize both rates by dividing each by $\var{S}$. Thus, we can define the interest rates as follows, where $\var{c}=constant$, $\var{U}=utilization$:

$$
\var{r_S}=\var{c} * \var{U} * \frac{B}{S} (1 - \var{r_R})
$$

$$
\var{r_B}=\var{c} * \var{U} * \frac{S}{S} = \var{c} * \var{U}
$$

This formula can be extended to support kinks:

$$
\var{r_S}= 
\begin{array}{ll}
    \var{c_{low}} * \var{U} * \frac{B}{S} (1 - \var{r_R}) \& \quad \var{U} \leq kink \\
    (\var{c_{low}} * kink + \var{c_{high}} * (\var{U} - kink)) \frac{B}{S} (1 - \var{r_R}) \& \quad \var{U} > kink \\
\end{array}
$$

$$
\var{r_B}= 
\begin{array}{ll}
    \var{c_{low}} * \var{U} \& \quad \var{U} \leq kink \\
    \var{c_{low}} * kink + \var{c_{high}} * (\var{U} - kink) \& \quad \var{U} > kink \\
\end{array}
$$



## Bulker etc. Contract :new:

We will have a contract outside of the monolithic protocol contract which provides bulking and other functionality. This isolates some of the code risk. However, this separate contract is still extremely potent, as users which interact with it will need to allow it to operate on their behalf.

See [RFC 018](https://docs.google.com/document/d/1MBO5EfLSt3uHPSUJ1I3shZzkxmpZHxA4k4vz3NNwEe0/edit#heading=h.ufct22s8n9zn)

### Types

```
struct Command {
 name: string or uint+enum;
 args: bytes;	
}
```

### Functions

#### invoke(bytes action, uint32 nonce) [External]

* handleCommand(Parsed(action))

#### invokeAll(bytes actions, uint32 nonce) [External]
* For command in Parsed(actions)
    * handleCommand(command)

#### handleCommand(Command cmd) [Internal]
* When $cmd.name$
    * SUPPLY
        * Let (from, dst, asset, amount) = abi.decode(cmd.args, (address, address, address, uint))
        * Require $from = \Sender$
        * Supply(from, dst, asset, amount)
    * TRANSFER
        * Let (src, dst, asset, amount) = abi.decode(cmd.args, (address, address, address, uint))
        * Require $src = \Sender$
        * Transfer(src, dst, asset, amount)
    * WITHDRAW
        * Let (src, to, asset, amount) = abi.decode(cmd.args, (address, address, address, uint))
        * Require $src = \Sender$
        * Withdraw(src, to, asset, amount)

### Optional Helpers

:::info
This section is incomplete.
:::

#### TransferStableMaxWithoutBorrowing(Operator, Src, Dst)
#### TransferStableMaxWithBorrowing(Operator, Src, Dst)
#### WithdrawStableMaxWithoutBorrowing(Operator, Src, To)
#### WithdrawStableMaxWithBorrowing(Operator, Src, To)
