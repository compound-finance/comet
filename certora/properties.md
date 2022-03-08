# Properties for Comet protocol


## Table

| # | Rule Name | Progress | Verdict | Comment | Update |
|-- | --------- | -------- | ------- | ------- | ------ |
|   |                      **Interest computation**                    |
| 1 | `supplyIndex_borrowIndex_GE_baseIndexScale` | DONE | ✅ | - | - |
| 2 | `supplyIndex_borrowIndex_monotonic` | DONE | ✅ | - | - |
| 3 | `supplyIndex_borrowIndex_rise_with_time` | DONE | ✅ | - | - |
| 4 | `borrowBase_vs_utilization` | DONE | ✅ | - | - |
| 5 | `utilization_zero` | DONE | ✅ | -| - |
| 6 | `isLiquiditable_false_should_not_change` |  DONE | ✅  | - | DONE |
| 7 | `presentValue_GE_principle` |  DONE | ✅ | - | No assumption |
| 8 | `presentValue_G_zero` | PROGRESS | 👷 | - | - |
| 9 | `presentValue_EQ_principal` | DONE | ✅ | - | No assumption |
| 10 | `supplyRate_vs_utilization` | DONE | ✅ | - | New rule |
| 11 | `utilization_zero_supplyRate_zero` | DONE | ✅ | - | New Rule |
| 12 | `getSupplyRate_revert_characteristic` | DONE | ✅  | reserveRate > factorScale() |  |
| 13 | `isCol_implies_not_isLiq` | PROGRESS | 👷 | - | New Rule |
|   |                       **Flags**                      |
| 14 | `check_flag_updates` | DONE | ✅ | update is coherent with getters | - |
| 15 | `check_flag_getters` | DONE | ✅ | getters are coherent with update | - |
| 16 | `check_pauseSupply_functionality` | DONE | ✅ | on safe summarization | - |
| 17 | `check_pauseTransfer_functionality` | DONE | ✅ | " | - |
| 18 | `check_pauseWithdraw_functionality` | DONE | ✅ | " | - |
| 19 | `check_pauseAbsorb_functionality` | DONE | ✅ | " | - |
| 20 | `check_pauseBuy_functionality` | DONE | ✅ | " | - |
| 21 | `check_update_UserCollateral` | IN PROGRESS | 👷 | expected to fail due to `offset > 8` (or 16 on fixed code) | FIX still open |
| 22 | `update_changes_single_bit` | DONE | ✅ | - | - |
| 23 | `update_changes_single_user_assetIn` | DONE | ✅ | - | - |
| | **Asset Info** |
| 24 | `reversibility_of_packing` | DONE | ✅ | need to recheck | NEW |
| | **High level totals** |
| 25 | `totalCollateralPerAsset` | DONE | ✅ | on simplified assumptions  | - |
| 26   | `totalCollateralPerAssetVsAssetBalance` | IN PROGRESS | 👷 | - | New - expecting to fail? |
| 27 | `totalBaseToken` | IN PROGRESS | 🕝 | on simplified assumptions | - |
| 28 | `base_balance_vs_totals` | IN PROGRESS | 👷| on simplified assumptions | - |
| 29 | `Collateral_totalSupply_LE_supplyCap` | DONE | ✅ | using the summarization of getAssetInfo | NEW |
| | **High level updates** |
| 30 | `assetIn_Initialized_With_Balance` | IN PROGRESS | 👷 | found issue with absorb | - |
| | **BuyCollateral** |
| 31 | `antiMonotonicityOfBuyCollateral` | DONE | ✅ | with assumptions asset!=base, minAmount > 0, and msg.sender| discuss minAmount |
| 32   | `buyCollateralMax` | DONE | ❌ | no limit, one can withdraw all asset, DOS on withdraw? |
| | **Absorb** |
| 33 | `absorb_reserves_increase` | IN PROGRESS | 👷  | - | NEW |
| | **Supply** |
| 34 | `supply_increase_balance` | IN PROGRESS | ✅ | need to generalize | NEW |
| | **Withdraw** |
| 35 | `additivity_of_withdraw` | IN PROGRESS | 🕝 | - | - |
| 36 | `withdraw_decrease_balance` | IN PROGRESS | ✅ | need to generalize | NEW |
| | **Reserve** |
| 37 | `withdraw_reserves_decreases` | DONE | ✅ | - | NEW |
| 38 | `withdraw_reserves_monotonicity` | DONE | ✅ | - | NEW |
| 39 | `no_reserves_zero_balance` | DONE | ✅ | on simplified assumptions | |
|    | **General**
| 40 | `verify_isBorrowCollateralized` | IN PROGRESS | 👷  | - | - | 
| 41 | `usage_registered_assets_only` | IN PROGRESS | 👷  | - | - |


## plan for upcoming weeks

- more high level properties from the list

- revert characteristic
1.  accrue 
2. dependency on reserveRate
3. max values

- reentrancy - callbacks from erc20
 also from priceoracle
 
- solidity flag `viaIR: true` 

-  review rules and study coverage by injecting bugs  


## Assumptions on Interest computation 


P1 := getTotalBaseSupplyIndex() >= baseIndexScale() && getTotalBaseBorrowIndex() >= baseIndexScale()

P2 := getTotalBaseBorrowIndex() > getTotalBaseSupplyIndex()

P3 := perSecondInterestRateSlopeLow() > 0 && perSecondInterestRateSlopeLow() < perSecondInterestRateSlopeHigh()

p4 := reserveRate(e) > 0


- V - require needed to pass

- X - not needed 

| Rule | P1 | P2 | P3 | P4 |
|----- | --- | -- | -- | -- |
| presentValue_GE_principal | ? | ? | ? | ?|
| presentValue_EQ_principal | ?| ? | ? | ? |





## Properties regarding accrue computation:

1. `SupplyIndex_BorrowIndex_GE_baseIndexScale` - Min value of baseSupplyIndex and baseBorrowIndex( ✅ ) - Gadi

2. `SupplyIndex_BorrowIndex_monotonic` - Monotonicity of baseSupplyIndex and baseBorrowIndex on accrue ( ✅ ) - Gadi

3. `SupplyIndex_BorrowIndex_rise_with_time` - Increase of baseSupplyIndex and baseBorrowIndex over time ( ✅ ) - Gadi



## Properties regarding interest computation: 

1. `borrowBase_vs_utilization` When no base is borrowed utilization should equal zero ( ✅ ) - Gadi

2. `utilization_zero` - Zero utilization is only on initial baseIntersetRate  ( ✅ ) - Gadi

3. `isLiquiditable_false_should_not_change` - computation of isLiquidatable on the same state changes from false to true only due to price change or accrue ( 👷 ) - Gadi

4. `isLiquiditable_true_should_not_change` - computation of isLiquidatable on the same state changes from true to false only due to price change, supplying more collateral, or supply more base ( 👷 ) - Gadi 

## Properties regarding variable evolution

1. `presentValue_greater_principle` - presentValue should always be greater or equal to principle. ( ✅ ) - Gadi

2. `presentValue_G_zero` - presentValue and principle value are initialized/not initialized together. ( ✅ ) - Gadi
    ```CVL
        presentValue > 0 <=> principleValue > 0
    ```

3. `presentValue_EQ_principle` - If presentValue and principle are equal, the totalBaseSupplyIndex is equal to baseIndexScale. ( ✅ ) - Gadi
    ```CVL
        present == principle => totalBaseSupplyIndex == baseIndexScale
    ```

## integrity of `pause()`:

1. `check_flag_updates` - pause revert only due to sender not being manager or guardian ( ✅ ) - Michael

2. `check_flag_getters` - getters return correct values according to pause input. ( ✅ ) - Michael

3. `check_pauseSupply_functionality`, `check_pauseTransfer_functionality`, `check_pauseWithdraw_functionality`, `check_pauseAbsorb_functionality`, `check_pauseBuy_functionality` - relevant functions revert if pause guardian is on ( ✅ ) - Michael

## integrity of user collateral asset:


1. `check_update_UserCollateral` - When `updateAssetIn` is being called with `initial_balance > 0 && final_balance == 0` the respective bit in assetIn should be 0 regardless of previous value, and when `initial_balance == 0 && final_balance > 0` the respective bit in assetIn should be 1 regardless of previous value. ( 👷 ) - Michael
    ```CVL
        initial_balance > 0 && final_balance == 0 => !IsInAsset(assetIn, assetOffset);
        initial_balance == 0 && final_balance > 0 => IsInAsset(assetIn, assetOffset);
    ```

2. `update_changes_single_bit` - update assetIn changes a single bit - it's impossible that 2 distinct asset bits will be change at the same call to update ( 🕝 ) - Michael

3. `update_changes_single_user_assetIn` - update assetIn changes the assetIn of a single user - no other users are affected by update. ( ✅ ) - Michael 





## High level properties

1. invariant `assetIn_Initialized_With_Balance` - iff user's balance of collateral asset is non-zero, the respective bit in assetIn is non-zero ( 👷 ) - Michael
    ```CVL
        User_Collateral_Balance_of_specific_asset == 0 <=> IsInAsset(Assetin_Of_User, Asset_Offset)
    ```

2. `additivity_of_withdraw` - withdrawing x and then y in 2 distinct calls is equivalent to withdrawing x+y in a single call ( 🕝 ) - Gadi

3. totalCollateralPerAsset ( ✅ ) - Nurit
The sum of collateral per asset over all users is equal to total collateral of asset
```CVL 
    sum(userCollateral[u][asset].balance) == totalsCollateral[asset].totalSupplyAsset
```
4. antiMonotonicityOfBuyCollateral ( 👷 ) - Nurit
On buyCollateral system's balanace in base should increase iff system's balance in asset decreased 

5. Basebalance_vs_totals( 👷 ) - Gadi

6. no_reserves_zero_balance ( 👷 ) - Gadi

7. The sum of collateral per asset over all users is equal to total collateral of asset:
```CVL 
sum(userCollateral[u][asset].balance) == totalsCollateral[asset].totalSupplyAsset
```

8. Summary of balances (base):
```CVL
sum(userBasic[u].principal) == totalsBasic.totalSupplyBase - totalsBasic.totalBorrowBase - ( ) Nurit
```

9. TotalSupplyAsset vs. external balance (collateral)*:
```CVL
totalsCollateral[asset].totalSupplyAsset == asset.balanceOf(this)
```
*In reality it can break in case of external transfer directly to the contract.
 
10. TotalSupplyBase vs. external balance (base):
```CVL
totalsBasic.totalSupplyBase - totalsBasic.totalBorrowBase <= base.balanceOf(this)
```
*It will be fine by the Compound team if we switch `==` with `<=`. can break with external transfer to the contract.

11. `Collateral_totalSupply_LE_supplyCap` - Max totalSupplyAsset (collateral)*: - ( ✅ ) Michael
    ```CVL 
        totalsCollateral[asset].totalSupplyAsset <= getAssetInfo().supplyCap
    ```
*This property can break in reality since a governor is able to change the config. In this case a governor can determine a supplycap smaller than current supply in the system.

## simplified Assumptions regarding comet*: 

- baseSupplyIndex and baseBorrowIndex at baseIndexScale


## Checking permissions.
- change in balance can only occur from sender == owner or if the sender is allowed
needs delegate call.


## isBorrowCollateralized
- isBorrowCollateralized == false -> f() -> isBorrowCollateralized == false (on the same timestamp accrue should not change the state)

## MICHAEL

2. If someone borrowed then his collateral more than zero:
    1. ```CVL
        userBasic.principle < 0 => UserCollateral.balance != 0
        ```
    
    2. On the borrowing block the collateral must be greater or equal to the borrow value.
    ```CVL
    collateral >= borrow
    ```
### asset uniqueness
- if an asset doesnt exist it should revert on every function call with asset.
asset_index, index_asset are correlated. not exist means index of asset is 0 and the asset in element 0 is not the same asset.











## work in progress 

1. Can always withdraw all collateral (assuming no debt) - low priority:
```CVL
    withdrawCollateral(userCollateral[user][asset].balance) will work
```

8. User’s collateral bigger than debt*:
```CVL
sum(userCollateral[user][asset].balance) >= presentValue(userBasic[user].principal)
```
*Assuming no price changes occur and `accrue` haven’t invoked. (`accrue` can pile debt on borrower and get him under water)

10. Can always withdraw all liquidity:
```CVL
withdrawBase(getBorrowLiquidity()/priceFeed) will work always
```

13. A user should get more rewards (interest) if he keeps its liquidity for longer.

14. Accrual time not in the future - `LastAccrualTime <= now` - Michael

15. If a liquidity provider and a borrower are entering and exiting the system at the same time the LP should be eligible for the whole asset(no amount stays locked in the system)* - Gadi. </br> 
*This is a special case of summary of balances (base). It should be checked if the wholesome property is too heavy on the tool. </br>
**It also happen only when the percentage goes to reserve is 0.

17. A user cannot borrow amount smaller than minimum borrow.

18. If a user borrowed then their balance is greater than the minimum amount.
```CVL
user.borrow != 0 => user.borrow >= min_borrow_amount
```

19. Anti-Monotonicty of liquidation (absorb):
    1. ```CVL
        totalSupply increases <=> totalBorrow decreases
        ```
    2. After buyCollateral() base increase, collateral decrease.

20. Additivity of multi liquidation:
```CVL
absorb(user A);absorb(user B) ~ absorb([A,B])
```

22. Preserved total assets of users: </br>
assuming 1:1 price between all tokens on the same timestamp*:
```CVL
sumExternalTokens() := sum(for all token: token.balanceOf(User) ) //including 

basesumAllInternal() := sum(for all assets: userCollateral[u][asset].balance) +userBasic[user].principal

{ before = sumExternalTokens() + sumAllInternal()}

op

{ sumExternalTokens() + sumAllInternal() = before }
```
*maybe on liquidation goes up

23. If the `getBorrowLiquidity` is positive, then the `getLiquidationMargin` is positive:
```CVL
getBorrowLiquidity > 0 => getLiquidationMargin > 0 
```

24. If `isLiquidatable` then `getLiquidationMargin` is negative and `getBorrowLiquidity` is negative
```CVL
isLiquidatable => getLiquidationMargin < 0 && getBorrowLiquidity < 0
```

25. getSupplyRateInternal monotonic with respect to utilization:
```CVL
SupplyRate rise <=> getUtilizationInternal rise
```

</br>

---
## TODO:</br>
1. `getBorrowLiquidity`  - probably can have a few rules

2. re-entrancy checks, especially in `absorb()` & `buyCollateral()`
