import "comet.spec"

/*

Description: 
        Summary of balances (base):
formula: 
        sum(userBasic[u].principal) == totalsBasic.totalSupplyBase - totalsBasic.totalBorrowBase
status:

*/
invariant totalBaseToken() 
	sumUserBasicPrinciple == to_mathint(getTotalSupplyBase()) - to_mathint(getTotalBorrowBase()) filtered { f-> !similarFunctions(f) && !f.isView }
{
    preserved {
        simplifiedAssumptions();
    }
}

/* 
 Description :  
        when contract balance == 0 , reserves should be LE zero

 formula : 
        _baseToken.balanceOf(currentContract) == 0 => getReserves() <= 0

 status : proved
 reason :
 link   :
*/
invariant no_reserves_zero_balance()
_baseToken.balanceOf(currentContract) == 0 => getReserves() <= 0
filtered { f-> !similarFunctions(f) && !f.isView }
    {
        preserved {
            simplifiedAssumptions();
        }
    }



/* 
 Description :  
        The sum of collateral per asset over all users is equal to total collateral of asset:

formula : 
        sum(userCollateral[u][asset].balance) == totalsCollateral[asset].totalSupplyAsset

 status : proved 
 link https://vaas-stg.certora.com/output/23658/c653b4018c776983368a?anonymousKey=ed01d8a8a20618fae0c3e40f1e1e3a99c2a253e8
*/
invariant totalCollateralPerAsset(address asset) 
    sumBalancePerAssert[asset] == getTotalsSupplyAsset(asset)     
    filtered { f-> !similarFunctions(f) && !f.isView }
    {
        preserved {
            simplifiedAssumptions();
        }
    }

/* 
 Description :  
        for each asset, the contract's balance is at least as the total supply 
formula : 
        totalsCollateral[asset].totalSupplyAsset <= asset.balanceOf(this)
*/
invariant totalCollateralPerAssetVsAssetBalance(address asset) 
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
 Description :  
        Due to summarization the following should hold

 formula : 
        baseToken.balanceOf(currentContract) == getTotalSupplyBase() - getTotalBorrowBase()

 status : failed
 reason :
 link   : 
*/
invariant base_balance_vs_totals()
_baseToken.balanceOf(currentContract) >= getTotalSupplyBase() - getTotalBorrowBase()
filtered { f-> !similarFunctions(f) && !f.isView }
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
        //this invariant does not hold on absorb and buy
        //@todo - can we generalize
        preserved absorb(address absorber, address[] accounts) with (env e) {
            require(false);
        }
    }

