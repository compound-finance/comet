import "comet.spec"    

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Total Assets and Balances  ////////////////////////
////////////////////////////////////////////////////////////////////////////////


/*
    @Rule

    @Description:
        The sum of collateral per asset over all users is equal to total collateral of asset:

    @Formula : 
        sum(userCollateral[u][asset].balance) == totalsCollateral[asset].totalSupplyAsset

    
    @Link: https://vaas-stg.certora.com/output/23658/01cae74fe43232e6e6c5/?anonymousKey=9f050514a528f70e110a2a9f2dde24ffb85f39da

*/
invariant total_collateral_per_asset(address asset) 
    sumBalancePerAssert[asset] == getTotalsSupplyAsset(asset)     
    filtered { f-> !similarFunctions(f) && !f.isView }
    {
        preserved {
            simplifiedAssumptions();
        }
    }

/*
    @Rule

    @Description:
        For each asset, the contract's balance is at least as the total supply 

    @Formula: 
        totalsCollateral[asset].totalSupplyAsset <= asset.balanceOf(this)

    @Notes: 
        Safely assume that comet is not the msg.sender, this is a safe assumption since there is no call statement from Comet to itself. 
        Also assume that no address can supply from Comet, as comet does not give allowance
    @Link: https://vaas-stg.certora.com/output/23658/01cae74fe43232e6e6c5/?anonymousKey=9f050514a528f70e110a2a9f2dde24ffb85f39da
*/

invariant total_asset_collateral_vs_asset_balance(address asset) 
    asset != _baseToken => 
        (getTotalsSupplyAsset(asset)  <= tokenBalanceOf(asset, currentContract) ) 
    filtered { f-> !similarFunctions(f) && !f.isView }
    {
        preserved with (env e){
            simplifiedAssumptions();
            require e.msg.sender != currentContract;
        }
        preserved supplyFrom(address from, address dst, address asset_, uint amount) with (env e) {
            simplifiedAssumptions();
            require e.msg.sender != currentContract;
            require from != currentContract;
        }
    }

/*
    @Rule

    @Description:
        The base token balance of the system, is at least the supplied minus the borrowed

    @Formula: 
        baseToken.balanceOf(currentContract) == getTotalSupplyBase() - getTotalBorrowBase()

    @Note: This invariant does not hold on absorb.  
     Safely assume that comet is not the msg.sender, this is a safe assumption since there is no call statement from Comet to itself. 
        Also assume that no address can supply from Comet, as comet does not give allowance
    @Link: https://vaas-stg.certora.com/output/23658/01cae74fe43232e6e6c5/?anonymousKey=9f050514a528f70e110a2a9f2dde24ffb85f39da     
         
*/
invariant base_balance_vs_totals()
    _baseToken.balanceOf(currentContract) >= getTotalSupplyBase() - getTotalBorrowBase()
    filtered { f-> !similarFunctions(f) && !f.isView && f.selector!=absorb(address, address[]).selector }
    {
        preserved with (env e){
            simplifiedAssumptions();
            require e.msg.sender != currentContract;
        }
        preserved buyCollateral(address asset, uint minAmount, uint baseAmount, address recipient) with (env e) {
            simplifiedAssumptions();
            require asset != _baseToken;
            require recipient != currentContract;
        }
        preserved supplyFrom(address from, address dst, address asset, uint amount) with (env e) {
            simplifiedAssumptions();
            require e.msg.sender != currentContract;
            require from != currentContract;
        }
    }

/*
    @Rule

    @Description:
        The total supply of an asset is not greater than it's supply cap

    @Formula: 
        baseToken.balanceOf(currentContract) == getTotalSupplyBase() - getTotalBorrowBase()
`
    @Link: https://vaas-stg.certora.com/output/23658/01cae74fe43232e6e6c5/?anonymousKey=9f050514a528f70e110a2a9f2dde24ffb85f39da     
         
*/
invariant collateral_totalSupply_LE_supplyCap(address asset)
    getTotalsSupplyAsset(asset) <= getAssetSupplyCapByAddress(asset)




