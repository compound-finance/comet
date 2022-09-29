
/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyInterestComputation.sh
    on a wrapped extension of comet that enables calling internal functions.
    It contains rule on the mathematical functions and variables such as:
    presentValue, principalValue, accrue, supply rate, borrow rate and more
*/

import "setup_noSummarization.spec"
 

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Methods Declarations   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

methods{

    call_presentValue(int104) returns (int256) envfree;
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
    getFactorScale() returns (uint64) envfree
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

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/4bb13f119ed44ccc0b04/?anonymousKey=f69fa5e910f1279c4b7c750442aa139164bafec1



/*
    @Rule

    @Description: supplyIndex_borrowIndex_monotonic
        baseSupplyIndex monotonic
        baseBorrowIndex monotonic

     @Formula:
        {   
            supply_index = getBaseSupplyIndex() &&
            borrow_index = getBaseBorrowIndex() &&
        }
            accrueInternal();
        { 
            getBaseSupplyIndex() >= supply_index &&
            getBaseBorrowIndex() >= borrow_index
        }


    @Notes:

    @Link:
        
*/

rule supplyIndex_borrowIndex_monotonic(){
    env e;
    uint64 base_supply_index_1 = getBaseSupplyIndex();
    uint64 base_borrow_index_1 = getBaseBorrowIndex();
    call_accrueInternal(e);
    uint64 base_supply_index_2 = getBaseSupplyIndex();
    uint64 base_borrow_index_2 = getBaseBorrowIndex();

    assert  base_supply_index_2 >= base_supply_index_1;
    assert  base_borrow_index_2 >= base_borrow_index_1;
}

/*
    @Rule

    @Description: utilization increase implies supplyRate increase
        If the utilization is increased the supplyRate cannot decrease

    @Formula:
        utilization(t1) > utilization(t2) => supplyRate(t2) >= supplyRate(t1)

    @Notes:

    @Link:
        
*/

rule supplyRate_vs_utilization(){
    env e1; env e2;
    setup(e1);

    uint   utilization_1 = getUtilization(e1);
    uint64 supplyRate_1 = getSupplyRate(e1, utilization_1);

    uint utilization_2 = getUtilization(e2);
    uint64 supplyRate_2 = getSupplyRate(e2, utilization_2);

    assert utilization_2 > utilization_1 => supplyRate_2 >= supplyRate_1;
}

/*
    @Rule

    @Description:
        When utilization is 0, borrow rate equals to the base borrow rate.

    @Formula:
        utilization(t) = 0 =>  getBorrowRate(t) = perSecondInterestRateBase() 
    @Notes:

    @Link:
        
*/

rule utilization_zero(){
    env e;
    setup(e);
    uint utilization = getUtilization(e);
    uint64 borrowRate = getBorrowRate(e, utilization);
    assert getUtilization(e) == 0 => borrowRate == perSecondInterestRateBase() ;
}


/*
    @Rule

    @Description:
        If nobody borrows from the system, the utilization must be 0.

    @Formula:
        getTotalBorrowBase(t) == 0 => utilization(t) == 0;

    @Notes:

    @Link:
        
*/

rule borrowBase_vs_utilization(){
    env e;
    assert getTotalBorrowBase(e) == 0 => getUtilization(e) == 0;
}

/*
    @Rule

    @Description:
        Verifies that isLiquidatable == false can change to true only if getPrice() has changed for base or asset
        A liquidatable user cannot turn un-liquidatable unless the price ratio of the collateral changed.

    @Formula:
     
        t2 > t1 && !isLiquidatable(t1,account) && isLiquidatable(t1,account) =>
           ( getPrice(t1,priceFeedBase) !=  getPrice(t2,priceFeedBase) ||
             getPrice(e1,priceFeedAsset) != getPrice(e2,priceFeedAsset) )

    @Notes: 
        This is without calling any functions, just due to change in time that result a change in price.

    @Link:
        
*/

rule isLiquidatable_false_should_not_change(address account){
    env e1; env e2;
    require e2.block.timestamp > e1.block.timestamp;
    setup(e1);

    /* we have two symbolic price feeds */
    address priceFeedBase;
    address priceFeedAsset;
    require priceFeedBase != priceFeedAsset;
    require isLiquidatable(e1,account) == false;
    uint priceBase1 = getPrice(e1,priceFeedBase);
    uint priceBase2 = getPrice(e2,priceFeedBase);

    uint priceAsset1 = getPrice(e1,priceFeedAsset);
    uint priceAsset2 = getPrice(e2,priceFeedAsset);

    assert isLiquidatable(e2,account) => 
                priceAsset1 != priceAsset2 || priceBase1 != priceBase2 ;
}

/*
    @Rule

    @Description:
        if a account is collateralized then it is not liquiditable

    @Formula:
        isBorrowCollateralized(account) => !isLiquidatable(account)

    @Notes:

    @Link:
        
*/

rule isCol_implies_not_isLiq(address account){
    env e;
    address asset;
    // assuming a condition that exist in the constructor
    require getLiquidateCollateralFactor(e,asset) > getBorrowCollateralFactor(e,asset);

    assert isBorrowCollateralized(e,account) => !isLiquidatable(e,account);
}

/*
    @Rule

    @Description:
        Verifies that TotalBaseSupplyIndex and getBaseBorrowIndex always greater than getBaseIndexScale

    @Formula:
        BaseSupplyIndex() >= BaseIndexScale() &&
        BaseBorrowIndex() >= BaseIndexScale();


    @Notes: 
        Proved to be used in other rules.

    @Link:
        
*/

rule supplyIndex_borrowIndex_GE_getBaseIndexScale(){
    env e;
    require getBaseSupplyIndex() >= getBaseIndexScale() &&
        getBaseBorrowIndex() >= getBaseIndexScale();
    
    call_accrueInternal(e);

    assert getBaseSupplyIndex() >= getBaseIndexScale() &&
        getBaseBorrowIndex() >= getBaseIndexScale();
}

/*
    @Rule

    @Description:
        presentValue always greater than principalValue

    @Formula:
        principalValue = principalValue(presentValue) =>
           (presentValue >= 0 => presentValue >= principalValue &&
            presentValue < 0 => presentValue <= principalValue ) 

    @Notes: 
        The absolute presentValue is GE to the absolute principalValue 

    @Link:
        
*/

rule absolute_presentValue_GE_principal(int104 presentValue){
    env e;
    setup(e);
    int104 principalValue = call_principalValue(presentValue);

    assert presentValue >= 0 => presentValue >= principalValue;
    assert presentValue < 0 => presentValue <= principalValue;
}


/*
    @Rule

    @Description:
        presentValue is positive iff principalValue is positive

    @Formula:
        ( principalValue = principalValue(presentValue) && 
          presentValue = presentValue(principalValue) )
            =>
        ( presentValue > 0 <=> principalValue > 0 )

    @Notes:

    @Link:
        
*/

rule presentValue_G_zero(int104 presentValue){
    env e;
    setup(e);
    int104 principalValue = call_principalValue(presentValue);
    int104 presentValue_ = call_presentValue(principalValue);
    assert presentValue_ == presentValue => 
    ( presentValue > 0 <=> principalValue > 0);
}


/*
    @Rule

    @Description:
        If utilization is 0, then supplyRate is 0

    @Formula:
        Utilization == 0 => SupplyRate == 0

    @Notes:

    @Link:
        
*/

rule utilization_zero_supplyRate_zero(){
    env e;
    uint utilization = getUtilization(e);
    assert utilization == 0 => getSupplyRate(e, utilization) == 0;
}
