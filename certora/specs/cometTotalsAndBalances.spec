/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyCometTotalsAndBalances.sh
    On a version with summarization ans some simplifications: 
    CometHarness.sol and setup_cometSummarization.spec

*/
import "comet.spec"    

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/7c69550a90b353bd60bb/?anonymousKey=352d17fdcec35858309a43f1b9a9047a0ba54c08

/*
    @Rule

    @Description:
        The sum of collateral per asset over all users is equal to total collateral of asset

    @Formula : 
        sum(userCollateral[user][asset].balance) = totalsCollateral[asset].totalSupplyAsset

    @Note:

*/

invariant total_collateral_per_asset(address asset) 
    sumBalancePerAsset[asset] == getTotalsSupplyAsset(asset)     
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

*/

invariant total_asset_collateral_vs_asset_balance(address asset) 
    (asset != _baseToken && asset != currentContract) => 
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
        baseToken.balanceOf(currentContract) >= getTotalSupplyBase() - getTotalBorrowBase()

    @Note:
        This invariant does not hold on absorb.  
        Safely assume that comet is not the msg.sender, this is a safe assumption since there is no call statement from Comet to itself. 
        Also assume that no address can supply from Comet, as comet does not give allowance
    
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
        totalsCollateral[asset].totalSupplyAsset <= getAssetSupplyCapByAddress(asset)

    @Note:

    @Link:
        https://vaas-stg.certora.com/output/23658/01cae74fe43232e6e6c5/?anonymousKey=9f050514a528f70e110a2a9f2dde24ffb85f39da
*/

invariant collateral_totalSupply_LE_supplyCap(address asset)
    getTotalsSupplyAsset(asset) <= getAssetSupplyCapByAddress(asset)


/*
    @Rule

    @Description:
        Summary of principal balances equals the totals

    @Formula: 
        sum(userBasic[user].principal) == totalsBasic.totalSupplyBase - totalsBasic.totalBorrowBase

    @Note:

    @Link:

*/

invariant total_base_token() 
	sumUserBasicPrincipal == to_mathint(getTotalSupplyBase()) - to_mathint(getTotalBorrowBase()) filtered { f-> !similarFunctions(f) && !f.isView }
{
    preserved {
        simplifiedAssumptions();
    }
}


/*
    @Rule

    @Description:
        User principal balance may decrease only by a call from them or from a permissioned manager

    @Formula:
        {
            x = userBasic[user].principal &&
            b = userCollateral[user][asset].balance &&
            p = hasPermission[user][msg.sender] 
        }

        < call op() by msg.sender>
        
        {
            ( userBasic[user].principal < x  => ( user = msg.sender || p ) ) &&
            userCollateral[user][asset].balance < y => ( user = msg.sender || p  || op=absorb )
        }

    @Notes:
        
    @Link:
        https://vaas-stg.certora.com/output/67509/8b70e8c3633a54cfc7ba?anonymousKey=d2c319cb2734c3978e15fa3833f55b19c48f8fda
*/

rule balance_change_by_allowed_only(method f, address user)
filtered { f-> !similarFunctions(f) && !f.isView }
{
    env e;
    calldataarg args;
    address asset;
    require asset != _baseToken;
    require user != currentContract;
    simplifiedAssumptions();

    int104 balanceBefore = getUserPrincipal(user);
    uint128 colBalanceBefore = getUserCollateralBalance(user, asset);

    f(e, args);

    int104 balanceAfter = getUserPrincipal(user);
    uint128 colBalanceAfter = getUserCollateralBalance(user, asset);
    bool permission = call_hasPermission(user, e.msg.sender);

    assert balanceAfter < balanceBefore => 
        ((e.msg.sender == user) || permission);
    assert colBalanceAfter < colBalanceBefore =>  (e.msg.sender == user || permission || f.selector == absorb(address,address[]).selector) ;
}


/*
    @Rule

    @Description:
        Any operation on a collateralized account leaves the account collateralized

    @Formula:
        {
            isBorrowCollateralized(e, user)
        }

        < call any function >
        
        {
            isBorrowCollateralized(e, user)
        }

    @Notes:
    
    @Link: 
    
*/

rule collateralized_after_operation(address user, address asset, method f) filtered {f -> !similarFunctions(f) && !f.isView && !f.isFallback} {
    env e;
    simplifiedAssumptions();
    require(getAssetOffsetByAsset(e,asset) == 0);
    require(isBorrowCollateralized(e, user));
    call_functions_with_specific_asset(f, e, asset);
    assert isBorrowCollateralized(e, user);
}