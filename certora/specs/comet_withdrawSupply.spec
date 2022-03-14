import "comet.spec"
/* 
 Description :  
        Can withdraw all contract's balance without revert

 formula : 
        withdraw(msg.sender, baseToken.balanceOf(currentContract)) -> no revert

 status : proved
 reason :
 link   : 
*/

rule withdraw_reserves_decreases(address to, uint amount){
    env e;

    int256 before = getReserves();
    withdrawReserves(e,to,amount);
    int256 after = getReserves();

    assert amount >0 && to != currentContract => before > after;
}


rule withdraw_reserves_monotonicity(address to){
    env e;

    uint amount1;
    uint amount2;
    require amount2 > amount1;    
    
    storage init = lastStorage;
    
    require to != currentContract && amount1 > 0;

    withdrawReserves(e,to,amount1);
        int reserves1 = getReserves();
    withdrawReserves(e,to,amount2) at init;
        int reserves2 = getReserves();

    assert reserves1 > reserves2;
}

rule supply_increase_balance(address asset, uint amount){
    env e;
    require e.msg.sender != currentContract;

    simplifiedAssumptions();


    uint balance1 = tokenBalanceOf(asset, currentContract);
    supply(e, asset, amount);
    uint balance2 = tokenBalanceOf(asset, currentContract);
    
    assert balance2 - balance1 == amount;
}

rule withdraw_decrease_balance(address asset, uint amount){
    env e;
    require e.msg.sender != currentContract;

    simplifiedAssumptions();

    uint balance1 = tokenBalanceOf(asset, currentContract);
    withdraw(e, asset, amount);
    uint balance2 = tokenBalanceOf(asset, currentContract);
    
    assert balance1 - balance2 == amount;
}


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