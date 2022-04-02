import "setup_noSummarization.spec"
import "erc20.spec"

using SymbolicBaseToken as _baseToken 

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Methods Declarations   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

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

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////   Functions   /////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

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

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: 


/*
    @Rule

    @Description:
        Calling to accrue is the only way to change presentValue

    @Formula:
        {
            getlastAccrualTime() == call_getNowInternal() &&
            presentValue1 = presentValue(principal)
        }

        < call any function >
        
        {
            presentValue2 = presentValue(principal)
            presentValue1 == presentValue2
        }

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

    @Notes: 
        Found bug - Accrue should be called prior to withdrawReserves() - FIXED

    @Link:
        
*/
rule withdraw_more_reserves(address to , uint amount){
    env e;
    require to != currentContract;

    withdrawReserves(e,to, amount);
    call_accrueInternal(e);

    assert getReserves(e) >= 0;
}


/*
    @Rule

    @Description: indices are increasing after accrue (when time elapse)
        baseSupplyIndex increase with time
        baseBorrowIndex increase with time

    @Formula:
        {   
            supply_index = getBaseSupplyIndex() &&
            borrow_index = getBaseBorrowIndex() &&
            lastUpdated = getlastAccrualTime()
        }
            accrueInternal();
        { }
            getNowInternal() > lastUpdated => getBaseSupplyIndex() > supply_index &&
                                              getBaseBorrowIndex() > borrow_index
    @Notes:

    @Link:
        
*/

rule supplyIndex_borrowIndex_rise_with_time(){
    env e;
    setup(e);
    uint64 base_supply_index_1 = getBaseSupplyIndex();
    uint64 base_borrow_index_1 = getBaseBorrowIndex();
    uint40 lastUpdated = getlastAccrualTime();
    call_accrueInternal(e);
    uint64 base_supply_index_2 = getBaseSupplyIndex();
    uint64 base_borrow_index_2 = getBaseBorrowIndex();

    assert call_getNowInternal(e) > lastUpdated => 
                (base_supply_index_2 > base_supply_index_1 &&
                base_borrow_index_2 > base_borrow_index_1); 
}