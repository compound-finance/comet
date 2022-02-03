# Properties for Comet protocol

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

5. Max totalSupplyAsset (collateral):
```CVL 
totalsCollateral[asset].totalSupplyAsset <= getAssetInfo().supplyCap
```

6. TotalSupplyAsset vs. external balance (collateral):
```CVL
totalsCollateral[asset].totalSupplyAsset == asset.balanceOf(this)
```

7. TotalSupplyBase vs. external balance (base):
```CVL
totalsBasic.totalSupplyBase - totalsBasic.totalBorrowBase == base.balanceOf(this)
```

8. User’s collateral bigger than debt*:
```CVL
sum(userCollateral[user][asset].balance) >= presentValue(userBasic[user].principal)
```
*Assuming no price changes occur

9. Maximum amount of debt:
```CVL
maxAmountToRepay <= amountBorrowed*((1+maxRate)**deltaT)

maxRate = baseRate + slopeLow*kink+slopeHigh*(1-kink)
```

10. Can always withdraw all liquidity:
```CVL
withdrawBase(getBorrowLiquidity()) will work always
```

11. If someone borrowed then his collateral more than zero:
```CVL
borrow[user] != 0 => collateral[user] != 0
```

12. `liquidateCollateralFactor > borrowCollateralFactor` - Michael

13. No borrow can be done before the reserve reaches a min of target reserves - Michael

14. A user should get more rewards (interest) if he keeps its liquidity for longer.

15. At deposit - LastAccrualTime <= now - Michael

16. If a liquidity provider and a borrower are entering and exiting the system at the same time the LP should be eligible for the whole asset. - Gadi (no amount stays locked in the system). </br>
This is a special case of summary of balances (base). It should be checked if the wholesome property is too heavy on the tool.

17. Change of liquidation state: - Gadi
    1. `isLiquidatable == false` should not change if getPrice do not change.
    
    2. `isLiquidatable == true` can change by supplying more collateral

18. A user cannot borrow amount smaller than minimum borrow.

19. If a user borrowed then their balance is greater than the minimum amount.
```CVL
user.borrow != 0 => user.borrow >= min_borrow_amount
```

20. Anti-Monotonicty of liquidation (absorb):
```CVL
base.balanceOf(this) increases <=> user gets assets (internally)
```

21. Additivity of multi liquidation:
```CVL
absorb(user A);absorb(user B) ~ absorb([A,B])
```

22. integrity of `pause()`:
    1. Updating one flag does not change the others.

    2. Correct usage of pause.

    3. Inverse of pause().

23. Preserved total assets of users: </br>
assuming 1:1 price between all tokens on the same timestamp*:
```CVL
sumExternalTokens() := sum(for all token: token.balanceOf(User) ) //including 

basesumAllInternal() := sum(for all assets: userCollateral[u][asset].balance) +userBasic[user].principal

{ before = sumExternalTokens() + sumAllInternal()}

op

{ sumExternalTokens() + sumAllInternal() = before }
```
*maybe on liquidation goes up

</br>

---
## TODO:</br>
`getBorrowLiquidity`  - probably can have a few rules