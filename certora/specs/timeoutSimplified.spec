// withdraw 

// T@T - withdraw(x) + withdraw(y) = withdraw(x+y)
rule additivity_of_withdraw( uint x, uint y){
    env e;
    storage init = lastStorage;
    
    simplifiedAssumptions();
    require x + y < 2^255;

    withdraw(e,_baseToken, x);
    int104 baseX = baseBalanceOf(e,e.msg.sender);
    withdraw(e,_baseToken, y);
    int104 baseY = baseBalanceOf(e,e.msg.sender);
    withdraw(e,_baseToken, x + y) at init;
    int104 baseXY = baseBalanceOf(e,e.msg.sender);

    assert baseXY == baseY;
}


// T@T -
rule borrow_then_collateralized(address user, address asset, method f) filtered {f -> !similarFunctions(f) && !f.isView && !f.isFallback} {
    env e;
    simplifiedAssumptions();
    require(getAssetOffsetByAsset(e,asset) == 0);
    require getPrincipal(user) < 0 => isBorrowCollateralized(e, user);
    call_functions_with_specific_asset(f, e, asset);
    assert getPrincipal(user) < 0 => isBorrowCollateralized(e, user);
}


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