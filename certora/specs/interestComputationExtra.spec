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
    baseIndexScale() returns (uint64) envfree;
    targetReserves() returns (uint256) envfree;
    latestRoundData() returns uint256 => DISPATCHER(true);

}

// BaseSupplyIndex and BaseBorrowIndex are monotonically increasing variables
// proved in supplyIndex_borrowIndex_GE_baseIndexScale.
function setup(env e){
    require getBaseSupplyIndex() >= baseIndexScale() &&
        getBaseBorrowIndex() >= baseIndexScale();
}

// latest run all : 
 
/* 
 Description :  
        baseSupplyIndex increase with time
        baseBorrowIndex increase with time

 formula : 

 status : proved
 
*/
// V@V - indices are increasing after accrue (when time elapse)
rule supplyIndex_borrowIndex_rise_with_time(){
    env e;
    uint64 base_supply_index_1 = getBaseSupplyIndex();
    uint64 base_borrow_index_1 = getBaseBorrowIndex();
    call_accrueInternal(e);
    uint64 base_supply_index_2 = getBaseSupplyIndex();
    uint64 base_borrow_index_2 = getBaseBorrowIndex();

    assert call_getNowInternal(e) > getlastAccrualTime() => 
                   (base_supply_index_2 > base_supply_index_1 &&
                    base_borrow_index_2 > base_borrow_index_1);
}


/* 
 Description :  
        baseSupplyIndex monotonic
        baseBorrowIndex monotonic

 formula : 

 status : proved

*/
// V@V - indices are monotonically increased
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
 Description :  
        utilization increase implies supplyRate increase

 formula : 

 status : proved
*/
// V@V - If the utilization is increased the supplyRate cannot decrease
rule supplyRate_vs_utilization(){
    env e1;
    env e2;
    setup(e1);

    uint   utilization_1 = getUtilization(e1);
    uint64 supplyRate_1 = getSupplyRate(e1);

    uint utilization_2 = getUtilization(e2);
    uint64 supplyRate_2 = getSupplyRate(e2);

    assert utilization_2 > utilization_1 => supplyRate_2 >= supplyRate_1;
}


/* 
 Description :  
     if borrowRate == base interest rate then utilization == 0   

formula : 
        borrowRate == perSecondInterestRateBase() => getUtilization(e) == 0;

 status : first assert proved

 reason : failed due to rounding down in utilization -> mulFactor
 link https://vaas-stg.certora.com/output/65782/b3fe39e314b1d0a592f5/?anonymousKey=877a0bbb8eea456fcacf3b5ed85d5c947d4cf890#utilization_zeroResults
*/
// V@V - When utilization is 0, borrow rate equals to the base borrow rate.
rule utilization_zero(){
    env e;
    setup(e);
    uint64 borrowRate = getBorrowRate(e);
    assert getUtilization(e) == 0 => borrowRate == perSecondInterestRateBase() ;
}


/* 
 Description :  
     if Borrow Base == 0 utilization should equal zero

formula : 
        getTotalBorrowBase(e) == 0 => getUtilization(e) == 0;

 status : proved
 
 reason : 
 */
 // V@V - If nobody borrows from the system, the utilization must be 0.
rule borrowBase_vs_utilization(){
    env e;
    assert getTotalBorrowBase(e) == 0 => getUtilization(e) == 0;
}

/* 
 Description :  
     Verifies that isLiquidatable == false can change to true only if getPrice() has changed for base or asset

 status : pass

 reason : 
 */
 // V@V - A liquiditable user cannot turn unliquiditable unless the price ratio of the collateral changed.
 // This is without calling any functions, just due to change in time that result a change in price
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
 Description :  
     isBorrowCollateralized => account can borrow, hence he's not Liquidatable
*/
// V@V - if a user is collateralized then they are not liquiditable
rule isCol_implies_not_isLiq(address account){
    env e;
    address asset;
    // assuming a condition that exist in the constructor
    require getLiquidateCollateralFactor(e,asset) > getBorrowCollateralFactor(e,asset);

    assert isBorrowCollateralized(e,account) => !isLiquidatable(e,account);
}

/* 
 Description :  
     Verifies that TotalBaseSupplyIndex and getBaseBorrowIndex always greater than baseIndexScale

formula : 
        getBaseSupplyIndex() >= baseIndexScale() &&
        getBaseBorrowIndex() >= baseIndexScale();

 status : proved

 reason : 

 link   : 
*/
// V@V - BaseSupplyIndex and BaseBorrowIndex are monotonically increasing variables
// proved to be used in other rules.
rule supplyIndex_borrowIndex_GE_baseIndexScale(){
    env e;
    require getBaseSupplyIndex() >= baseIndexScale() &&
        getBaseBorrowIndex() >= baseIndexScale();
    
    call_accrueInternal(e);

    assert getBaseSupplyIndex() >= baseIndexScale() &&
        getBaseBorrowIndex() >= baseIndexScale();
}


/* 
 Description :  
     presentValue always greater than principalValue

formula : 
     presentValue >= _principalValue;

 status : proved
 reason : 
 link   : https://vaas-stg.certora.com/output/65782/f2f32f50a2bbf14deb79/?anonymousKey=494980dfd3ebcced1ee0d1088acf1a795f9f2a08#SupplyIndex_vs_BorrowIndexResults
*/
// V@V - the absolute presentValue is GE to the absolut principleValue 
rule absolute_presentValue_GE_principal(int104 presentValue){
    env e;
    setup(e);
    int104 principalValue = call_principalValue(presentValue);

    assert presentValue >= 0 => presentValue >= principalValue;
    assert presentValue < 0 => presentValue <= principalValue;
}

// V@V - 
rule presentValue_G_zero(int104 presentValue){
    env e;
    setup(e);
    int104 principalValue = call_principalValue(presentValue);
    assert presentValue > 0 <=> principalValue > 0;
}


rule presentValue_EQ_principal(int104 presentValue){
    env e;
   setup(e);
    
    require getBaseBorrowIndex() > getBaseSupplyIndex();
    // https://vaas-stg.certora.com/output/65782/683fbc8491afe9dab5e0/?anonymousKey=4f9fb2a878f00e7301e64c53ff9e3d55c804aa6b#presentValue_EQ_principalResults
    
    int104 principalValue = call_principalValue(presentValue);
    int104 presentValueInv = call_presentValue(principalValue);

    require presentValue != 0;
    // https://vaas-stg.certora.com/output/65782/a9dfef3acdd36876a26f/?anonymousKey=4649138f310d0a7a36b20d7d146e0f9e23d6215e

    assert presentValue == principalValue => 
            getBaseSupplyIndex() == baseIndexScale() && 
            presentValueInv == presentValue;
}

rule quote_Collateral(address asset, uint baseAmount){
    env e;
    uint64 scale = getAssetScaleByAsset(asset);
    require scale == baseScale(e);
    require baseAmount > 0 && baseAmount < 2^255;
    uint quote1 = quoteCollateral(e,asset, baseAmount);
    uint quote2 = quoteCollateral(e,asset, baseAmount + 1);

    uint price = getPrice(e,asset);

    assert quote2 - quote1 <= scale * price;
}


/* This rule checks if getSupplyRate always reverts on 
reserveRate(e) > factorScale()

status: No violation - so the function always revert 
*/
/*
rule getSupplyRate_revert_characteristic(){
    env e;

    require reserveRate(e) > FACTOR_SCALE();
   
    getSupplyRate(e);

    assert false;
}
*/

rule utilization_zero_supplyRate_zero(){
    env e;
    assert getUtilization(e) == 0 => getSupplyRate(e) == 0;
}

rule withdraw_affects(method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e;
    calldataarg args;
  
  call_accrueInternal(e);

  int104 principal;
  int104 presentValue1 = call_presentValue(principal);
        f(e,args) ;
  int104 presentValue2 = call_presentValue(principal);
  
  assert presentValue1 == presentValue2;
}

rule verify_isBorrowCollateralized(address account, method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e;
    calldataarg args;

    require isBorrowCollateralized(e,account);
    f(e,args) ;
    assert isBorrowCollateralized(e,account);
}

rule additivity_of_withdraw(uint x, uint y){
    env e;
    storage init = lastStorage;
    
    // simplifiedAssumptions();
    require x + y < 2^255;

    withdraw(e,_baseToken, x);
    int104 baseX = baseBalanceOf(e.msg.sender);
    withdraw(e,_baseToken, y);
    int104 baseY = baseBalanceOf(e.msg.sender);
    
    withdraw(e,_baseToken, x + y)  at init;
    int104 baseXY = baseBalanceOf(e.msg.sender);

    assert baseXY == baseY;
}

rule withdraw_more_reserves(address to , uint amount){
    env e;
    require to != currentContract;

    withdrawReserves(e,to, amount);
    call_accrueInternal(e);
    int reserves = getReserves(e);

    assert reserves >= 0;
}

