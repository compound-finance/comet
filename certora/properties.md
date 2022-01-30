# Properties for Comet protocol

## Valid state properties (invariants)
### summary of balances
    sum(userCollateral[u][asset].balance) == totalsCollateral[asset].totalSupplyAsset

### max totalSupplyAsset 
    totalsCollateral[asset].totalSupplyAsset <= getAssetInfo().supplyCap

### totalSupplyAsset vs. external balance
    totalsCollateral[asset].totalSupplyAsset <= asset.balanceOf(this)


### borrow safety
    borrow more than zero than collateral more than zero 

## State transition 



## Revert characteristic properties 




## Properties for accrue function




## Properties for asset ERC20
ERC20 properties for assets that are listed on comet  