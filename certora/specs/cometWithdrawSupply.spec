/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyCometWithdrawAndSupply.sh
    On a version with summarization ans some simplifications: 
    CometHarness.sol and setup_cometSummarization.spec

    This files contains rules related to withdraw and supply functions 

*/
import "comet.spec"

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/99a246e5f5d8283f105a/?anonymousKey=9bcfba613c2844f47591636fc141b424e1d25d65

/*
    @Rule

    @Description:
        when a manager withdraw from the reserves, the system's reserves must decrease

    @Formula:
    {
        before = getReserves()
    }

    withdrawReserves(to,amount)
    
    {
        amount > 0 => getReserves() < before 
    }

    @Notes:

    @Link:
    
*/

rule withdraw_reserves_decreases(address to, uint amount){
    env e;

    int256 before = getReserves(e);
    withdrawReserves(e,to,amount);
    int256 after = getReserves(e);

    assert (amount > 0 && to != currentContract) => before > after;
}


/*
    @Rule

    @Description:
        The more a manager withdraw from reserves, the less reserves the system should have

    @Formula:
    {
        
    }
     
    withdrawReserves(x); r1 = getReserves()
    ~ 
    withdrawReserves(y); r2 = getReserves()
    
    {
        x > y => r1 > r2
    }

    @Notes:

    @Link:

*/

rule withdraw_reserves_monotonicity(address to){
    env e;

    uint amount1;
    uint amount2;

    storage init = lastStorage;
    require to != currentContract && amount1 > 0;

    withdrawReserves(e,to,amount1);
        int reserves1 = getReserves(e);
    withdrawReserves(e,to,amount2) at init;
        int reserves2 = getReserves(e);

    assert amount2 > amount1 => reserves1 > reserves2;
}


/*
    @Rule

    @Description:
        integrity of supply - balance increased by supply amount 

    @Formula:
    {
        balance1 = tokenBalanceOf(asset, currentContract)
    }
    
    supply(asset, amount)
    
    {
        tokenBalanceOf(asset, currentContract) - balance1 == amount
    }

    @Notes:
        should increase presentValue by amount

    @Link:

*/

rule supply_increase_balance(address asset, uint amount){
    env e;
    require e.msg.sender != currentContract;
    require asset != currentContract; // addition

    simplifiedAssumptions();

    uint balance1 = tokenBalanceOf(asset, currentContract);
    uint debt_user = borrowBalanceOf(e, e.msg.sender);
    supply(e, asset, amount);
    uint balance2 = tokenBalanceOf(asset, currentContract);
    
    assert amount != max_uint256 ? balance2 - balance1 == amount : balance2 - balance1 == debt_user;
}


/*
    @Rule

    @Description:
        integrity of withdraw - balance decreased by supply amount

    @Formula:
    {
        b = tokenBalanceOf(asset, currentContract)
    }
    
    withdraw(asset, amount)
    
    {
        b - tokenBalanceOf(asset, currentContract) = amount
    }

    @Notes:
        should decrease presentValue by amount

    @Link:
*/

rule withdraw_decrease_balance(address asset, uint amount){
    env e;
    require e.msg.sender != currentContract;
    require asset != currentContract; // addition

    simplifiedAssumptions();

    uint balance1 = tokenBalanceOf(asset, currentContract);
    uint balance_user = balanceOf(e, e.msg.sender);
    withdraw(e, asset, amount);
    uint balance2 = tokenBalanceOf(asset, currentContract);

    assert amount != max_uint256 ? balance1 - balance2 == amount : balance1 - balance2 == balance_user;
}

/*
    @Rule

    @Description:
        Splitting a withdraw to two step result in the same outcome
    @Formula:
    {
        
    }
    
    withdraw(Base, x); withdraw(Base, y) ; base1 := baseBalanceOf(e.msg.sender)
    ~
    withdraw(_baseToken, x + y); base2 := baseBalanceOf(e.msg.sender)
    
    {
        base1 = base2
    }

    @Notes:

    @Link:

*/

rule additivity_of_withdraw( uint x, uint y){
    env e;
    storage init = lastStorage;
    
    simplifiedAssumptions();
    require x + y < 2^255;

    withdraw(e,_baseToken, x);
    int256 baseX = baseBalanceOf(e.msg.sender);
    withdraw(e,_baseToken, y);
    int256 baseY = baseBalanceOf(e.msg.sender);
    withdraw(e,_baseToken, x + y) at init;
    int256 baseXY = baseBalanceOf(e.msg.sender);

    assert baseXY == baseY;
}