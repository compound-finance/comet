import "A_setupNoSummarization.spec"
import "erc20.spec"

using SymbolicBaseToken as _baseToken 

methods{

    call_presentValue(int104) returns (int104) envfree;
    call_principalValue(int104) returns (int104) envfree;
    getAssetScaleByAsset(address) returns (uint64) envfree;
    getBaseSupplyIndex() returns (uint64) envfree;
    getBaseBorrowIndex() returns (uint64) envfree;
    getlastAccrualTime() returns (uint40) envfree;
    perSecondInterestRateBase() returns (uint256) envfree;
    perSecondInterestRateSlopeLow() returns (uint256) envfree;
    perSecondInterestRateSlopeHigh() returns (uint256) envfree;
    kink() returns (uint256) envfree;
    getBaseIndexScale() returns (uint64) envfree;
    targetReserves() returns (uint256) envfree;
    latestRoundData() returns (uint256) => DISPATCHER(true);
    get_FACTOR_SCALE() returns (uint64) envfree
}

// BaseSupplyIndex and BaseBorrowIndex are monotonically increasing variables
// proved in supplyIndex_borrowIndex_GE_getBaseIndexScale.
function setup(env e){
    require getBaseSupplyIndex() >= getBaseIndexScale() &&
        getBaseBorrowIndex() >= getBaseIndexScale();
}

// The supply index and borrow index are set to the initial value - simplify computation
function simplifiedAssumptions() {
    require getBaseSupplyIndex() == getBaseIndexScale();
    require getBaseBorrowIndex() == getBaseIndexScale();
}

/*
    @Rule

    @Description:
        At a point in time where user is collateralized, no action will change its status to uncollateralized

    @Formula:
        {
            lastAccrualTime() == getNowInternal() &&
            isBorrowCollateralized(account)
        }
        
        < call any function >
        
        {
            isBorrowCollateralized(account)
        }

    @Notes:
        

    @Link:
*/
rule verify_isBorrowCollateralized(address account, method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e; calldataarg args;
    simplifiedAssumptions();

    require getlastAccrualTime() == call_getNowInternal(e);

    require isBorrowCollateralized(e,account);
    f(e,args) ;
    assert isBorrowCollateralized(e,account);
}

/*
    @Rule

    @Description:
        Calling to accrue is the only way to change presentValue

    @Formula:
        presentValue1 = presentValue(principal)
        call any function
        presentValue2 = presentValue(principal)
        assert presentValue1 == presentValue2

    @Notes:

    @Link:
        
*/
rule only_accrue_change_presentValue(method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e; calldataarg args;
    simplifiedAssumptions();  

    require getlastAccrualTime() == call_getNowInternal(e); // don't call accrue

  int104 principal;
  int104 presentValue1 = call_presentValue(principal);
        f(e,args);
  int104 presentValue2 = call_presentValue(principal);
  
  assert presentValue1 == presentValue2;
}

/*
    @Rule
        withdraw_more_reserves

    @Description:
        withdrawReserves cannot end up with negative reserves

    @Formula:
    {

    }
        withdrawReserves(amount);
        accrueInternal();
    {
        Reserves() >= 0
    }

    @Notes: Found bug - Accrue should be called prior to withdrawReserves() - FIXED

    @Link:
        
*/
rule withdraw_more_reserves(address to , uint amount){
    env e;
    require to != currentContract;

    withdrawReserves(e,to, amount);
    call_accrueInternal(e);

    assert getReserves(e) >= 0;
}



rule increase_profit(){
    env e1;
    env e2;
    require e2.block.timestamp > e1.block.timestamp;

    uint amount;
    address account1;
    address account2 = e1.msg.sender;

    require account1 != currentContract && account2 != currentContract;

    // simplifiedAssumptions();

    // call_accrueInternal(e1);

    mathint presentValue_account1_1 = to_mathint(call_presentValue(getUserPrincipal(e1,account1)));
    mathint presentValue_account2_1 = to_mathint(call_presentValue(getUserPrincipal(e1,account2)));

    require presentValue_account1_1 != 0;
    require presentValue_account2_1 == 0;

    withdraw(e1, _baseToken, amount);

    require call_getNowInternal(e1) > getlastAccrualTime();
    call_accrueInternal(e1);
    
    mathint presentValue_account1_2 = to_mathint(call_presentValue(getUserPrincipal(e2,account1)));
    mathint presentValue_account2_2 = to_mathint(call_presentValue(getUserPrincipal(e2,account2)));

    assert presentValue_account1_2 - presentValue_account1_1 >= presentValue_account2_2 - presentValue_account2_1;
}
