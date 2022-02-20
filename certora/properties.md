# Properties for Comet protocol

solidity flag `viaIR: true` ()

## Properties regarding accrue computation:

1. Min value of baseSupplyIndex and baseBorrowIndex( ✔️ )

2. Monotonicity of baseSupplyIndex and baseBorrowIndex on accrue ( ✔️ )

3. Increase of baseSupplyIndex and baseBorrowIndex over time ( ✔️ )



## Properties regarding interest computation: 
3. When no base is borrowed utilization should equal zero ( ✔️ )

4. Zero utilization is only on initial baseIntresetRate  (✔️ )

5. computation of isLiquidatable on the same state changes from false to true only due to price change  ( ✔️ )

## work in progress/ questions 
 1. utilization <= factorScale() 

 fails on total borrow (presentValue) can be greater then totalSupply (presentValue) hence utilization not bounded


  2. assumptions that are used but not checked in constructor:
 
     getTotalBaseSupplyIndex() >= baseIndexScale()       
     getTotalBaseBorrowIndex() >= baseIndexScale()
     getTotalBaseBorrowIndex() >= getTotalBaseSupplyIndex() -- not safe --
    getBorrowRate() > getSupplyRate()
    perSecondInterestRateSlopeLow() > 0 &&  perSecondInterestRateSlopeLow() < perSecondInterestRateSlopeHigh() -- check when needed --
    reserveRate() > 0

 
 
## Properties regarding comet*: 
starting to prove with some simplifications:

- baseSupplyIndex and baseBorrowIndex at baseIndexScale


1. The sum of collateral per asset over all users is equal to total collateral of asset ( ✔️ )
```CVL 
sum(userCollateral[u][asset].balance) == totalsCollateral[asset].totalSupplyAsset
```

## work in progress 

1. Can always withdraw all collateral (assuming no debt) - low priority:
```CVL
withdrawCollateral(userCollateral[user][asset].balance) will work
```

2. Each collateral asset should be unique (and probably distinct from the base asset).

3. The sum of collateral per asset over all users is equal to total collateral of asset:
```CVL 
sum(userCollateral[u][asset].balance) == totalsCollateral[asset].totalSupplyAsset
```

4. Summary of balances (base):
```CVL
sum(userBasic[u].principal) == totalsBasic.totalSupplyBase - totalsBasic.totalBorrowBase
```

5. Max totalSupplyAsset (collateral)*:
    1. ```CVL 
        totalsCollateral[asset].totalSupplyAsset <= getAssetInfo().supplyCap
        ```
    *This property can break in reality since a governor is able to change the config. In this case a governor can determine a supplycap smaller than current supply in the system. In this case the following property should hold:

    2. ```CVL
        totalsCollateral[asset].totalSupplyAsset > getAssetInfo().supplyCap => no deposit of assets are possible
        ```

6. TotalSupplyAsset vs. external balance (collateral)*:
```CVL
totalsCollateral[asset].totalSupplyAsset == asset.balanceOf(this)
```
*In reality it can break in case of external transfer directly to the contract.

7. TotalSupplyBase vs. external balance (base):
```CVL
totalsBasic.totalSupplyBase - totalsBasic.totalBorrowBase == base.balanceOf(this)
```
*It will be fine by the Compound team if we switch `==` with `<=`. can break with external transfer to the contract.

8. User’s collateral bigger than debt*:
```CVL
sum(userCollateral[user][asset].balance) >= presentValue(userBasic[user].principal)
```
*Assuming no price changes occur and `accrue` haven’t invoked. (`accrue` can pile debt on borrower and get him under water)

9. Maximum amount of debt:
```CVL
maxAmountToRepay <= amountBorrowed*((1+maxRate)**deltaT)

maxRate = baseRate + slopeLow*kink+slopeHigh*(1-kink)
```

10. Can always withdraw all liquidity:
```CVL
withdrawBase(getBorrowLiquidity()/priceFeed) will work always
```

11. If someone borrowed then his collateral more than zero:
    1. ```CVL
        borrow[user] != 0 => collateral[user] != 0
        ```
    
    2. On the borrowing block the collateral must be greater or equal to the borrow value.
    ```CVL
    collateral >= borrow
    ```

12. `liquidateCollateralFactor > borrowCollateralFactor` - Michael

13. A user should get more rewards (interest) if he keeps its liquidity for longer.

14. Accrual time not in the future - `LastAccrualTime <= now` - Michael

15. If a liquidity provider and a borrower are entering and exiting the system at the same time the LP should be eligible for the whole asset(no amount stays locked in the system)* - Gadi. </br> 
*This is a special case of summary of balances (base). It should be checked if the wholesome property is too heavy on the tool. </br>
**It also happen only when the percentage goes to reserve is 0.

16. Change of liquidation state: - Gadi
    1. `isLiquidatable == false` should not change if getPrice do not change.
    
    2. `isLiquidatable == true` can change by supplying more collateral

17. A user cannot borrow amount smaller than minimum borrow.

18. If a user borrowed then their balance is greater than the minimum amount.
```CVL
user.borrow != 0 => user.borrow >= min_borrow_amount
```

19. Anti-Monotonicty of liquidation (absorb):
```CVL
totalSupply increases <=> totalBorrow decreases
```

20. Additivity of multi liquidation:
```CVL
absorb(user A);absorb(user B) ~ absorb([A,B])
```

21. integrity of `pause()`:
    1. Updating one flag does not change the others.

    2. Correct usage of pause.

    3. Inverse of pause().

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

26. borrow rate should always be higher than the supply rate:
```CVL
BorrowRate > SupplyRate
```

</br>

---
## TODO:</br>
1. `getBorrowLiquidity`  - probably can have a few rules

2. re-entrancy checks, especially in `absorb()` & `buyCollateral()`