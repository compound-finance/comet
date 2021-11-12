---
title: Compound Comet Draft Specification
tags: comet, v2.5, protocol, spec
---
$$
\require{cancel}
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
\newcommand{\Now}{\SystemParam{System}{Now}}
\newcommand{\Sender}{\SystemParam{Msg}{Sender}}
\newcommand{\This}{\SystemParam{Contract}{This}}
%
% common params
\newcommand{\Account}{\Param{Account}}
\newcommand{\Asset}{\Param{Asset}}
\newcommand{\From}{\Param{From}}
\newcommand{\To}{\Param{To}}
\newcommand{\Src}{\Param{Src}}
\newcommand{\Dst}{\Param{Dst}}
\newcommand{\Amount}{\Param{Amount}}
%
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
\newcommand{\GetSupplyRate}{\Func{GetSupplyRate}{}}
\newcommand{\GetBorrowRate}{\Func{GetBorrowRate}{}}
\newcommand{\PrincipalValue}[1]{\Func{PrincipalValue}{#1}}
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
\newcommand{\CheckPerms}[1]{\HasPermission{#1}{ \Sender}}
$$


# Compound Comet [Draft]
###### Compound Engineering, November 2021

## Overview
Given that most borrowing activity in DeFi today consists of supplying volatile crypto assets and borrowing a single borrowable base token, we aim to achieve greater capital efficiency (including gas costs) by building a specialized protocol which allows you to supply volatile assets, and borrow only a single (e.g. stable) coin.

#### Value Proposition

1. More capital efficiency (more dollars for same collateral*)
2. Optimized for common usage (crypto collateral, USDC** borrows)
3. Fine-grained access controls for delegating account management
4. Internalize liquidation / profits

\* Collateral here exclusively refers to an ERC-20 token (or a similar token standard for a different blockchain). The native token (e.g. Ether) must be wrapped as either WETH or LIDO to be used as collateral.

\*\* Base token refers to the single borrowable asset, e.g. USDC. We may also refer to this as the base token.

> We should be clear when we expect the base token to have a fixed price or require an oracle price?
> [name=hayesgm] [time=Wed, Nov 10, 2021 11:47 AM]

## Architecture

### Contracts
As the goal of Comet is to be highly optimized for a particular use case, we seek to minimize the number of contracts involved. The protocol is implemented primarily in a monolithic contract. We assume all math operations revert in the case of overflow or underflow. We assume all values are unsigned 32-byte integers unless otherwise specified.

### Prices
:::info
This section is incomplete.
:::

The protocol will use the v2 price feed

### Interest Rates
Unlike Compound v2, where the supply rate is derived from the borrow rate and reserve factor, in Compound Comet the protocol has a distinct borrow and supply rate curve for the borrowed token. Separating the rate curves gives governance more fine-grained control over supply rates and reserves, the downside is that it requires twice as much work from governance to maintain. However, since Comet only supports borrowing and supply rates in the stable coin market, the management complexity is still less than v2.

### Balances, Principal and Indices
A multiplicative index can be calculated as:

\\[Index_{T_1} = Index_{T_0} (T_1-T_0)\\]

where $Index_{T}$ represents the interest index at time $T$, and $T_N$ represents the wall clock time (e.g. as a Unix epoch). Multiplicative indices are usually applied as $Balance_{T_1}=Balance_{T_0} \cdot \frac{Index_{T_1}}{Index_{T_0}}$. That is, the ratio of two indices is a multiplicative factor which correctly moves a balance forward in time with interest. This is the same method used in Compound v2 _C-Tokens_.

In Comet, interest-bearing balances are represented internally as _principal_ amounts. A principal, derived from a balance at time T, is a new balance, such that if you accrued interest from the beginning of time, that balance's current vaue, at time T, would equal the original given balance. That is, it is what a balance would have been at $T_0$ to be equal in value today. This principal value can be easily derived for a $Balance_{T_N}$ by taking $Principal = Balance_{T_N} \cdot \frac{Index_{T_0}}{Index_{T_N}}$. The alternative would be to store the tuple $(Balance_{T_N}, T_N)$, but we can save space by storing the singular _principal_. We sometimes refer to principals as day-zero balances, since they correspond to the balance as of the first index, $Index_{T_0}$.

Indices are always assumed to be unsigned integers, while balances are signed integers. This is in contrast to Compound v2 where both indices and balances were unsigned. However in v2, balances were separated into supply and borrow amounts, whereas here they are combined into a single signed number (and thus supply and borrow cannot be maintained at the same time, for an account balance of any asset).

### Factors

A _factor_ through this document refers to a fixed-digit decimal number. Specifically, a decimal number scaled by 1e18. These numbers should be treated as real numbers scaled down by 1e18. For example, the number 50% would be represented as $0.5e18$ and stored in binary as $0x4563918244f40000$.

\* Note: not to be confused with $CollateralFactor$ values, which may themselves, be stored as _factors_.

## Protocol Contract

### Configuration Constants
| Name | Type | Description |
| ---- | ---- | ----------- |
| $\newcommand{\Governor}{\Config{Governor}} \Governor$ | $address$ | The governor of the protocol.
| $\newcommand{\PriceOracle}{\Config{PriceOracle}} \PriceOracle$ | $address$   | Address of the [price oracle](#Prices). |
| $\newcommand{\BaseToken}{\Config{BaseToken}} \BaseToken$ | $address$   | Address of the base token. |
| $\newcommand{\CollateralAssets}{\Config{CollateralAssets}} \CollateralAssets$ | $address[]$ | The list of collateral asset addresses. |
| $\newcommand{\BorrowCollateralFactor}[1]{\Config{BorrowCollateralFactor}_{#1}} \BorrowCollateralFactor{Asset}$ | $factor$ | Collateral factor for given asset required in order to initiate a borrow. |
| $\newcommand{\LiquidateCollateralFactor}[1]{\Config{LiquidateCollateralFactor}_{#1}} \LiquidateCollateralFactor{Asset}$| $factor$ | Collateral factor for given asset used when performing liquidity checks. Greater than the $\BorrowCollateralFactor{Asset}$ to avoid excessive liquidation.
| $\newcommand{\LiquidationPenalty}[1]{\Config{LiquidationPenalty}_{#1}} \LiquidationPenalty{Asset}$ | $factor$ | Fraction of collateral value received in borrow token when liquidated. |
| $\newcommand{\StoreFrontDiscountFactor}[1]{\Config{StoreFrontDiscountFactor}_{#1}} \StoreFrontDiscountFactor{Asset}$ | $factor$ | Factor to multiply by when calculating the store-front collateral price. |
| $\newcommand{\TargetReserves}{\Config{TargetReserves}} \TargetReserves$ | $uint$ | Minimum borrow token reserves which must be held before collateral is hodled. |
| $\newcommand{\AbsorbTip}{\Config{AbsorbTip}} \AbsorbTip$ | $uint$ | _TO BE DEFINED_ |
| $\newcommand{\BorrowMin}{\Config{BorrowMin}} \BorrowMin$ | $uint$ | The minimum borrow amount required to enter into a borrow position. |
| $\newcommand{\SupplyCap}[1]{\Config{SupplyCap}_{#1}} \SupplyCap{Asset}$ | $uint$ | Maximum supply of asset which is allowed to be supplied. |
| $\newcommand{\BaseTrackingSupplySpeed}{\Config{BaseTrackingSupplySpeed}} \BaseTrackingSupplySpeed$ | $factor$ | Speed to track per second for suppliers. |
| $\newcommand{\BaseTrackingBorrowSpeed}{\Config{BaseTrackingBorrowSpeed}} \BaseTrackingBorrowSpeed$ | $factor$ | Speed to track per second for borrowers. |

### Storage

| Name | Type | Description |
| ---- | ---  | ----------- |
| $\newcommand{\TotalSupplyBase}{\Storage{TotalSupplyBase}} \TotalSupplyBase$ | $uint72$ | Total amount of base token principal which the protocol owes to suppliers. |
| $\newcommand{\TotalBorrowBase}{\Storage{TotalBorrowBase}} \TotalBorrowBase$ | $uint72$ | Total amount of base token principal which borrowers owe to the protocol. |
| $\newcommand{\LastAccrualTime}{\Storage{LastAccrualTime}} \LastAccrualTime$ | $uint48$ | Timestamp of last interest accrual.<br/><br/>_Note_: Split storage between 2 slots with 24-bits available each. |
| $\newcommand{\BaseSupplyIndex}{\Storage{BaseSupplyIndex}} \BaseSupplyIndex$ | $uint64$ | Interest index for base token supply principal. |
| $\newcommand{\BaseBorrowIndex}{\Storage{BaseBorrowIndex}} \BaseBorrowIndex$ | $uint64$ | Interest index for base token borrow principal. |
| $\newcommand{\TrackingSupplyIndex}{\Storage{TrackingSupplyIndex}} \TrackingSupplyIndex$ | $uint96$ | Index tracking total protocol participation for supply. |
| $\newcommand{\TrackingBorrowIndex}{\Storage{TrackingBorrowIndex}} \TrackingBorrowIndex$ | $uint96$ | Index tracking the total protocol partipcation for borrows. |
| $\newcommand{\IsPermitted}[2]{\Storage{IsPermitted}_{#1,\ #2}} \IsPermitted{Owner}{Manager}$ | $bool$ | Whether or not the $Manager$ has permission to manage the $Owner$ account. |
| $\newcommand{\UserPrincipal}[1]{\Storage{UserPrincipal}_{#1}} \UserPrincipal{Account}$ | $int72$ | Amount of stable coin principal which is owed to a given account (+) or by it (-). |
| $\newcommand{\UserBaseTrackingIndex}[1]{\Storage{UserBaseTrackingIndex}_{#1}} \UserBaseTrackingIndex{Account}$ | $uint96$ | The index tracking user participation for a given account. |
| $\newcommand{\UserBaseTrackingAccrued}[1]{\Storage{UserBaseTrackingAccrued}_{#1}} \UserBaseTrackingAccrued{Account}$ | $uint48$ | Total participation tracking index previously earned by an account.
| $\newcommand{\TotalCollateral}[1]{\Storage{TotalCollateral}_{#1}} \TotalCollateral{Asset}$ | $uint128$ | Total amount of given collateral asset which the protocol owes to borrowers. |
| $\newcommand{\CollateralTrackingIndex}[1]{\Storage{CollateralTrackingIndex}_{#1}} \CollateralTrackingIndex{Asset}$ | $uint128$ | The global tracking index for an asset.  [TBD] |
| $\newcommand{\UserCollateral}[2]{\Storage{UserCollateral}_{#1,\ #2}} \UserCollateral_{Asset,\ Account}$ | $uint128$ | Amount of given collateral asset owed to a given account. |
| $\newcommand{\UserCollateralTrackingIndex}[2]{\Storage{UserCollateralTrackingIndex}_{#1,\ #2}} \UserCollateralTrackingIndex_{Asset,\ Account}$ | $uint128$ | The collateral tracking index for an asset as of the last balance interaction by an account. [TBD] |

> **TODO**: We’re pretty much going to need implicit assets you’re in, otherwise liquidity checks are too expensive
> * 16-bit vector stored with UserStable?
> [name=Jared] [time=Mon, Nov 8, 2021 10:00 PM] [color=blue]
 

### Constructor

#### Constructor()

* **Write** $\LastAccrualTime = \Now$
* **Write** $\BaseSupplyIndex = 1.0$
* **Write** $\BaseBorrowIndex = 1.0$
* **Write** $\TrackingSupplyIndex = 1.0$
* **Write** $\TrackingBorrowIndex = 1.0$

### Account Functions

#### Allow(Owner, Manager, IsAllowed)
Allow or disallow another address to withdraw, or transfer from the Sender address.

* **Write** $\IsPermitted{Owner}{Manager} = \Param{IsAllowed}$

#### SupplyCollateral(From, Dst, Asset, Amount) [Internal]
Supplies a collateral token to the protocol, which the account can later borrow against.

* **Require** $\CheckPerms{\From}$
* **External Trx** $\transferFrom{\Asset}{\From, \This, \Amount}$
  * Let $\txAmount$ be the actual amount transferred less any fees.
* **Write** $\TotalCollateral{\Asset} \pluseq \txAmount$
* **Write** $\UserCollateral{\Asset}{\Dst} \pluseq \txAmount$
* **Require** $\TotalCollateral{\Asset} \leq \SupplyCap{\Asset}$

#### SupplyBase(From, Dst, Amount) [Internal]
Transfers in borrow token pegged to the user's account. This will repay any outstanding borrows before adding to a user's supply. If the user has a positive supply balance, their accont will receive yield along the supply curve.

* **Require** $\CheckPerms{\From}$
* **External Trx** $\transferFrom{\Asset}{\From, \This, \Amount}$
  * Let $\txAmount$ be the actual amount transferred less any fees.
* **Call** $\Accrue$
* **Read** $\var{dstPrincipal}=\UserPrincipal{\Dst}$
* Let $\var{dstBalance} = \PresentValue{\var{dstPrincipal}}$
* **Read** $\var{totalSupplyBaseBalance} = \PresentValueSupply{\TotalSupplyBase}$
* **Read** $\var{totalBorrowBaseBalance} = \PresentValueBorrow{\TotalBorrowBase}$
* Let $\var{repaySupply} = \RepayAndSupplyAmount{\var{dstBalance}}{\txAmount}$
* Let $\var{dstBalance'} = \var{dstBalance} + \txAmount$
* Let $\var{totalSupplyBaseBalance'} = \var{totalSupplyBaseBalance} + \var{repaySupply_{supply}}$
* Let $\var{totalBorrowBaseBalance'} = \var{totalBorrowBaseBalance} - \var{repaySupply_{repay}}$
* **Call** $\UpdateBaseBalance{\Dst}{\var{dstPrincipal}}{\PrincipalValue{\var{dstBalance'}}}$
* **Write** $\TotalSupplyBase = \PrincipalValueSupply{\var{totalSupplyBaseBalance'}}$
* **Write** $\TotalBorrowBase = \PrincipalValueBorrow{\var{totalBorrowBaseBalance'}}$

#### TransferCollateral(Src, Dst, Asset, Amount) [Internal]
Transfers collateral between users. Reverts if the Src user would have negative liquidity after the transfer. 

* **Require** $\CheckPerms{\Src}$
* **Write** $\UserCollateral{\Asset}{\Src} \subeq \Amount$
* **Write** $\UserCollateral{\Asset}{\Dst} \pluseq \Amount$
* **Require** $\IsBorrowCollateralized{\Src}$
  * _Note_: We don’t need to accrue interest since $Borrow CF < Liquidation CF$ covers small changes

#### TransferBase(Src, Dst, Amount) [Internal]
Transfers base token between accounts. Reverts if $\Src$ account would have negative liquidity after the transfer. 

* **Require** $\CheckPerms{\Src}$
* **Call** $\Accrue$
* **Read** $\var{srcPrincipal} = \UserPrincipal{\Src}$
* **Read** $\var{dstPrincipal} = \UserPrincipal{\Dst}$
* Let $\var{srcBalance} = \PresentValue{\var{srcPrincipal}}$
* Let $\var{dstBalance} = \PresentValue{\var{dstPrincipal}}$
* **Read** $\var{totalSupplyBaseBalance} = \PresentValueSupply{\TotalSupplyBase}$
* **Read** $\var{totalBorrowBaseBalance} = \PresentValueBorrow{\TotalBorrowBase}$
* Let $\var{withdrawBorrow} = \WithdrawAndBorrowAmount{\var{srcBalance}}{\Amount}$
* Let $\var{repaySupply} = \RepayAndSupplyAmount{\var{dstBalance}}{\Amount}$
* Let $\var{srcBalance'} = \var{srcBalance} - \Amount$
* Let $\var{dstBalance'} = \var{dstBalance} + \Amount$
* Let $\var{totalSupplyBaseBalance'} = \var{totalSupplyBaseBalance} + \var{repaySupply_{supply}} - \var{withdrawBorrow_{withdraw}}$
* Let $\var{totalBorrowBaseBalance'} = \var{totalBorrowBaseBalance} + \var{withdrawBorrow_{borrow}} - \var{repaySupply_{repay}}$
* **Call** $\UpdateBaseBalance{\Src}{\var{srcPrincipal}}{\PrincipalValue{\var{srcBalance'}}}$
* **Call** $\UpdateBaseBalance{\Dst}{\var{dstPrincipal}}{\PrincipalValue{\var{dstBalance'}}}$
* **Write** $\TotalSupplyBase = \PrincipalValueSupply{\var{totalSupplyBaseBalance'}}$
* **Write** $\TotalBorrowBase = \PrincipalValueBorrow{\var{totalBorrowBaseBalance'}}$
* If $\var{srcBalance'} \lt 0$
   * **Require** $|\var{srcBalance'}| \geq \BorrowMin$

#### WithdrawCollateral(Src, To, Asset, Amount) [Internal]
Transfers out collateral from the $\Sender$ account to the $\To$ account. Reverts if the caller would have negative liquidity after withdrawal.

* **Require** $\CheckPerms{\Src}$
* **Write** $\TotalCollateral{\Asset} \subeq \Amount$
* **Write** $\UserCollateral{\Asset}{\Src} \subeq \Amount$
* **Require** $\IsBorrowCollateralized{\Src} \lor \Sender = \This$
  * _Note_: Primary conditional allows selling reclaimed collateral while underwater.
* **External Trx** $\transfer{\Asset}{\To, \Amount}$

#### WithdrawBase(Src, To, Amount) [Internal]
Transfers out base token from the $\Sender$ account to the $\To$ account. Reverts if the caller would have negative liquidity after withdrawal.

* **Require** $\CheckPerms{\Src}$
* **Call** $\Accrue$
* **Read** $\var{srcPrincipal} = \UserPrincipal{\Src}$
* Let $\var{srcBalance} = \PresentValue{\var{srcPrincipal}}$
* **Read** $\var{totalSupplyBaseBalance} = \PresentValueSupply{\TotalSupplyBase}$
* **Read** $\var{totalBorrowBaseBalance} = \PresentValueBorrow{\TotalBorrowBase}$
* Let $\var{withdrawBorrow} = \WithdrawAndBorrowAmount{\var{srcBalance}}{\Amount}$
* Let $\var{srcBalance'} = \var{srcBalance} - \Amount$
* Let $\var{totalSupplyBaseBalance'} = \var{totalSupplyBaseBalance} - \var{withdrawBorrow_{withdraw}}$
* Let $\var{totalBorrowBaseBalance'} = \var{totalBorrowBaseBalance} + \var{withdrawBorrow_{borrow}}$
* **Call** $\UpdateBaseBalance{\Src}{\var{srcPrincipal}}{\PrincipalValue{\var{srcBalance'}}}$
* **Write** $\TotalSupplyBase = \PrincipalValueSupply{\var{totalSupplyBaseBalance'}}$
* **Write** $\TotalBorrowBase = \PrincipalValueBorrow{\var{totalBorrowBaseBalance'}}$
* If $\var{srcBalance'} \lt 0$
  * **Require** $|\var{srcBalance'}| \geq \BorrowMin$
* **Require** $\IsBorrowCollateralized{\Src}$
* **External Trx** $\transfer{\BaseToken}{\To}{\Amount}$

### Interest and Tracking Functions

#### Accrue() [Internal]
Accrue interest in base token supply and borrows. This function also tracks participation in the protocol.

* **Read** $\var{timeElapsed} = \Now - \LastAccrualTime$
* When $\var{timeElapsed} \gt 0$:
  * **Write** $\BaseSupplyIndex \pluseq \BaseSupplyIndex \cdot \GetSupplyRate \cdot \var{timeElapsed}$
  * **Write** $\BaseBorrowIndex \pluseq \BaseBorrowIndex \cdot \GetBorrowRate \cdot \var{timeElapsed}$
  * **Write** $\TrackingSupplyIndex \pluseq \frac{\BaseTrackingSupplySpeed}{\TotalSupplyBase} \cdot \var{timeElapsed}$
  * **Write** $\TrackingBorrowIndex \pluseq \frac{\BaseTrackingBorrowSpeed}{\TotalBorrowBase} \cdot \var{timeElapsed}$
  * **Write** $\LastAccrualTime = \Now$

#### UpdateBaseBalance(Account, InitialUserBalance, FinalUserBalance) [Internal]
Write updated balance to store and tracking participation.

* When $\Param{InitialUserBalance} \geq 0$:
  * **Read** $\var{indexDelta} = \TrackingSupplyIndex - \UserBaseTrackingIndex{\Account}$
* Otherwise
  * **Read** $\var{indexDelta} = \TrackingBorrowIndex - \UserBaseTrackingIndex{\Account}$
* When $\Param{FinalUserBalance} \geq 0$:
  * **Write** $\UserBaseTrackingIndex{\Account} = \TrackingSupplyIndex$
* Otherwise
  * **Write** $\UserBaseTrackingIndex{\Account} = \TrackingBorrowIndex$
* **Write** $\UserBaseTrackingAccrued{Account} \pluseq \Param{InitialUserBalance} \cdot \var{indexDelta}$

#### GetSupplyRate(): factor
Return the current supply rate for the stable coin market.

> Q: Do we expect this to make one or more READs?
> [name=hayesgm] [time=Wed, Nov 10, 2021 11:52 PM]
> > I think we could pass in the vars we've already read to be worked out in solidity, but prob we can just carry everything around in a memory struct?
> > [name=jared] [color=blue]

#### GetBorrowRate(): Factor
Return the current borrow rate for the stable coin market.

> Q: Do we expect this to make one or more READs?
> [name=hayesgm] [time=Wed, Nov 10, 2021 11:52 PM]

### Liquidation Functions

#### Absorb(Account)
Transfer user’s debt to protocol accounts, decreasing cash reserves and adding collateral to the protocol's own balance. The caller is given an absorption incentive.

* **Require** $\IsLiquidatable{\Account}$
* **Read** $\var{acctPrincipal}=\UserPrincipal{\Account}$
* Let $\var{acctBalance} = \PresentValue{\var{acctPrincipal}}$
* Initialize $\var{acctBalance'} = \var{acctBalance}$
* For $\var{asset} \in \CollateralAssets$ `# TODO: Assets you're in?`
  * **Read** $\var{seizeAmount} = \UserCollateral{\var{asset}}{\Account}$
  * If $\var{seizeAmount} \gt 0$:
    * **Write** $\UserCollateral{\var{asset}}{\Account} \subeq \var{seizeAmount}$
      * TODO: is this always eq 0?
    * **Write** $\UserCollateral{\var{asset}}{\This} \pluseq \var{seizeAmount}$
      * TODO: liq dao?
    * $\var{acctBalance'} \pluseq \var{seizeAmount} \times \GetPrice{\var{asset}} \cdot \LiquidationPenalty{\var{asset}}$
* $\var{acctBalance'} = max(\var{acctBalance'}, 0)$
    * TODO: Should we track any deficit here?
* **Write** $\UserPrincipal{\Account} = \PrincipalValue{\var{acctBalance'}}$
  * TODO: Why don't we use UpdateBaseBalance here?
* **Write** $\TotalSupplyBase \pluseq \PrincipalValueSupply{\var{acctBalance'}}$
* **Write** $\TotalBorrowBase \subeq \PrincipalValueBorrow{|\var{acctBalance}|}$
* Let $\var{absorptionIncentive} = \text{total gas of transaction} (BASEFEE + \AbsorbTip)$
* **External Trx** $\transfer{\BaseToken}{\Sender, \var{absorptionIncentive}}$

:::danger
XXX: Fix Absorption incentive
We need gas of absorb not the transaction, we should be able to make a good/safe over-estimate, assuming we cap what external calls can cost
:::

#### Absorb(Accounts)
Absorb multiple accounts at once.

* For $\var{account} \in \Param{Accounts}$:
  * Call $\mathop{Absorb}(\var{account})$

#### AskPrice(Asset, Amount)
Calculate the store-front price for a given amount of collateral for sale. Does not check if the quantity is actually available for sale.

* Return $\GetPrice{\Asset} \cdot \StoreFrontDiscountFactor{\Asset}$

#### BuyCollateral(Asset, Amount, BaseAmount)
Buy collateral from the protocol using base tokens, increasing reserves. A minimum collateral amount should be specified to indicate the maximum slippage acceptable for the buyer.

Note: we choose to implement a simple auction strategy which seemed to do well in simulations, this is a likely point for experimentation within the protocol. 

* **When** $\GetReserves \lt \TargetReserves$:
  * **Read** $\var{collateralAmount} = {\Param{BaseAmount} \over AskPrice(Asset, Amount)}$
  * **Require** $\var{collateralAmount} ≥ MinCollateralAmount$
  * **Call** $SupplyReserves(\Sender, \Sender, BaseAmount)$
  * **Call** $WithdrawCollateral(\This, \This, Recipient, Asset, collateralAmount)$

### Reserves Functions

#### _WithdrawReserves(To, Amount) [Internal]
Withdraw reserves from the protocol to another account. 

* **Require** $\Sender = \Governor$
* **External Trx** $\transfer{\BaseToken}{\To}{\Amount}$

#### GetReserves(): int
* **External Call** $\var{thisBalance} = \balanceOf{\BaseToken}{\This}$
* Return $\var{thisBalance} - \PresentValueSupply{\TotalSupplyBase} + \PresentValueBorrow{\TotalBorrowBase}$

### Helper Functions

#### IsBorrowCollateralized(Account): bool
Returns true if the account has non-negative liquidity using the borrow collateral factors.

* **Read** $\var{liquidity} = -1 \times \PresentValue{\UserPrincipal{\Account}}$
* For $\var{asset} \in \CollateralAssets$
    * If $\var{liquidity} \geq 0$
        * Return $true$
    * $\var{liquidity} \pluseq \UserCollateral{\var{asset}}{\Account} \cdot \GetPrice{\Asset} \cdot \BorrowCollateralFactor{\Asset}$
* Return $\var{liquidity} \geq 0$

#### IsLiquidatable(Account): bool
Returns true if the account has negative liquidity using the liquidation collateral factors.

* **Read** $\var{liquidity} = -1 \times \PresentValue{\UserPrincipal{\Account}}$
* For $\var{asset} \in \CollateralAssets$
    * If $\var{liquidity} \geq 0$
        * Return $true$
    * $\var{liquidity} \pluseq \UserCollateral{\var{asset}}{\Account} \cdot \GetPrice{\Asset} \cdot \LiquidateCollateralFactor{\Asset}$
* Return $\var{liquidity} \geq 0$

#### GetPrice(Asset): factor
Get the price of an asset.

#### HasPermission(address Owner, address Manager): bool
* **Return** $\Param{Owner} = \Param{Manager} \lor \IsPermitted{\Param{Owner}}{\Param{Manager}}$

#### PrincipalValue(int PresentValue): int
Return the positive principal supply balance if positive or the negative borrow balance if negative.

* If $\Param{PresentValue} \geq 0$:
  * Return $\PrincipalValueSupply{\Param{PresentValue}}$
* Else:
  * Return $\PrincipalValueBorrow{\Param{PresentValue}}$

#### PrincipalValue<sub>Supply</sub>(uint PresentValue): uint
Return the amount projected backward by the supply index.
* **Read and Return** $\frac{\Param{PresentValue}}{\BaseSupplyIndex}$

#### PrincipalValue<sub>Borrow</sub>(uint PresentValue): uint
Return the amount projected backward by the borrow index.

* **Read and Return** $\frac{\Param{PresentValue}}{\BaseBorrowIndex}$

#### PresentValue(int PrincipalValue): int
Return the positive present supply balance if positive or the negative borrow balance if negative.

* If $\Param{PrincipalValue} ≥ 0$:
  * Return $\PresentValueSupply{\Param{PrincipalValue}}$
* Else
  * Return $\PresentValueBorrow{\Param{PrincipalValue}}$

#### PresentValue<sub>Supply</sub>(uint PrincipalValue): uint
Return the principal amount projected forward by the supply index.

* **Read and Return** $\Param{PrincipalValue} \cdot \BaseSupplyIndex$

#### PresentValue<sub>Borrow</sub>(uint PrincipalValue): uint
Return the principal amount projected forward by the borrow index.

* **Read and Return** $\Param{PrincipalValue} \cdot \BaseBorrowIndex$

#### RepayAndSupplyAmount(int Balance, uint Amount): (uint, uint)

* Let $\var{repayAmount} = max(min(-\Param{Balance}, \Amount), 0)$
* Let $\var{supplyAmount} = \Amount - \var{repayAmount}$
* Return $\{\var{repay}=\var{repayAmount}, \var{supply}=\var{supplyAmount}\}$

#### WithdrawAndBorrowAmount(int Balance, uint Amount): (uint, uint)

* Let $\var{withdrawAmount} = max(min(\Param{Balance}, \Amount), 0)$
* Let $\var{borrowAmount} = \Amount - \var{withdrawAmount}$
* Return $\{\var{withdraw}=\var{withdrawAmount}, \var{borrow}=\var{borrowAmount}\}$

## Liquidation
When an account goes underwater, its position can be absorbed into the protocol account, buying all the collateral belonging to the position in exchange for paying down their debt. The protocol then attempts to sell off the collateral in order to recover reserves which have been paid out to accounts in this way.

## Tracking
The protocol tracks participation in markets and accrues that to each account. This allows external contracts to confidently pull information about how long an account has participated in the Compound Protocol and how much value that account has provided to the protocol, in general.

## Optional or External Helpers

:::info
This section is incomplete.
:::

#### TransferStableMaxWithoutBorrowing(Sender, Src, Dst)
#### TransferStableMaxWithBorrowing(Sender, Src, Dst)
#### WithdrawStableMaxWithoutBorrowing(Sender, Src, To)
#### WithdrawStableMaxWithBorrowing(Sender, Src, To)
#### XXXAndCall(Sender, ...)
#### GaslessSigning
