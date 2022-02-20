import "A_setupNoSummarization.spec"

methods{
    getSpecificSupplyRateInternal(uint64,uint64,uint64,uint64) returns (uint64) envfree;
    getSpecificBorrowRateInternal(uint64,uint64,uint64,uint64) returns (uint64) envfree;
    getSpecificUtilizationInternal(uint64,uint64,uint64,uint64) returns (uint)  envfree;

    getTotalBaseSupplyIndex() returns (uint64) envfree;
    getTotalBaseBorrowIndex() returns (uint64) envfree;
    getlastAccrualTime() returns (uint40) envfree;
    factorScale() returns (uint64) envfree;
    perSecondInterestRateBase() returns (uint64) envfree;
    perSecondInterestRateSlopeLow() returns (uint64) envfree;
    perSecondInterestRateSlopeHigh() returns (uint64) envfree;
    kink() returns (uint64) envfree;
    baseIndexScale() returns (uint64) envfree;
    targetReserves() returns (uint104) envfree;
}

 
/* 
 Description :  
        baseSupplyIndex increase with time
        baseBorrowIndex increase with time

 formula : 
        getNow(e) > getlastAccrualTime() => 
                   (base_supply_index_2 > base_supply_index_1 &&
                    base_borrow_index_2 > base_borrow_index_1);

 status : proved
 reason :
 link https://vaas-stg.certora.com/output/23658/497f4791d345a3dce667/?anonymousKey=43aadbf11d704a33e7143188189ea806a9d39d03#supplyRate_vs_UtilizationResults
*/
rule SupplyIndex_BorrowIndex_rise_with_time(){
    env e;
    uint64 base_supply_index_1 = getTotalBaseSupplyIndex();
    uint64 base_borrow_index_1 = getTotalBaseBorrowIndex();
    accrue(e);
    uint64 base_supply_index_2 = getTotalBaseSupplyIndex();
    uint64 base_borrow_index_2 = getTotalBaseBorrowIndex();

    assert getNow(e) > getlastAccrualTime() => 
                   (base_supply_index_2 > base_supply_index_1 &&
                    base_borrow_index_2 > base_borrow_index_1);
}

 
/* 
 Description :  
        baseSupplyIndex monotonic
        baseBorrowIndex monotonic

 formula : 
        base_supply_index_2 >= base_supply_index_1 &&
        base_borrow_index_2 >= base_borrow_index_1

 status : proved
 reason :
 link https://vaas-stg.certora.com/output/65782/5240447a217a62b1d892/?anonymousKey=cddebb60c69464b5d715c547ab600e08ea032c0c#isLiquidatable_false_should_not_changeResults
*/
rule SupplyIndex_BorrowIndex_monotonic(){
    env e;
    uint64 base_supply_index_1 = getTotalBaseSupplyIndex();
    uint64 base_borrow_index_1 = getTotalBaseBorrowIndex();
    accrue(e);
    uint64 base_supply_index_2 = getTotalBaseSupplyIndex();
    uint64 base_borrow_index_2 = getTotalBaseBorrowIndex();

    assert  base_supply_index_2 >= base_supply_index_1;
    assert  base_borrow_index_2 >= base_borrow_index_1;
}
 
/* 
 Description :  
        utilization increase implies supplyRate increase

 formula : 
        utilization_2 > utilization_1 => supplyRate_2 > supplyRate_1

 status : failed
 reason :
 link https://vaas-stg.certora.com/output/65782/5240447a217a62b1d892/?anonymousKey=cddebb60c69464b5d715c547ab600e08ea032c0c#isLiquidatable_false_should_not_changeResults
*/
rule supplyRate_vs_Utilization(){
env e;
    setup(e);

uint64 baseSupplyIndex1;
uint64 baseBorrowIndex1;
uint64 trackingSupplyIndex1;
uint64 trackingBorrowIndex1;

uint64 supplyRate_1 = getSpecificSupplyRateInternal(baseSupplyIndex1,baseBorrowIndex1,trackingSupplyIndex1,trackingBorrowIndex1);
uint   utilization_1 = getSpecificUtilizationInternal(baseSupplyIndex1,baseBorrowIndex1,trackingSupplyIndex1,trackingBorrowIndex1);

uint64 baseSupplyIndex2;
uint64 baseBorrowIndex2;
uint64 trackingSupplyIndex2;
uint64 trackingBorrowIndex2;

uint64 supplyRate_2 = getSpecificSupplyRateInternal(baseSupplyIndex2,baseBorrowIndex2,trackingSupplyIndex2,trackingBorrowIndex2);
uint utilization_2 = getSpecificUtilizationInternal(baseSupplyIndex2,baseBorrowIndex2,trackingSupplyIndex2,trackingBorrowIndex2);

    assert utilization_2 > utilization_1 => supplyRate_2 > supplyRate_1;
}

/* 
 Description :  
        if totalBorrow equals totalSupply then utilization == factorScale
formula : 
        utilization <= factorScale()

 status : failed
 reason : total borrow (presentValue) can be greater then totalSupply (presentValue) hence utilization not bounded
 link https://vaas-stg.certora.com/output/23658/497f4791d345a3dce667/?anonymousKey=43aadbf11d704a33e7143188189ea806a9d39d03#utilization_LE_factorScaleResults
*/
rule utilization_LE_factorScale(){
env e;
    setup(e);

uint utilization = getUtilization(e);
    assert utilization <= factorScale();
}

/* 
 Description :  
     if borrowRate == base interest rate then utilization == 0    
formula : 
        borrowRate == perSecondInterestRateBase() => getUtilization(e) == 0;

 status : failed
 reason : failed due to rounding down in mulFactor
 link https://vaas-stg.certora.com/output/65782/b3fe39e314b1d0a592f5/?anonymousKey=877a0bbb8eea456fcacf3b5ed85d5c947d4cf890#utilization_zeroResults
*/

rule utilization_zero(){
env e;
    setup(e);

    uint64 borrowRate = getBorrowRate(e);

    // for debug
    uint64 perSecondInterestRateBase1 = perSecondInterestRateBase();
    uint64 perSecondInterestRateSlopeLow1 = perSecondInterestRateSlopeLow();
    uint64 perSecondInterestRateSlopeHigh1 = perSecondInterestRateSlopeHigh();
    uint64 kink1 = kink();


    assert borrowRate == perSecondInterestRateBase() => getUtilization(e) == 0;
}
    
/* 
 Description :  
     if utilization == 0 then borrowRate == base interest rate
formula : 
        getUtilization(e) == 0 => borrowRate == perSecondInterestRateBase() ;

 status : proved
 reason 
 link https://vaas-stg.certora.com/output/65782/6018316af8badf9f4784/?anonymousKey=a398c2ee2252a5bccff160ace3d9c135cba691d1
*/
rule utilization_zero2(){
env e;
    setup(e);

    uint64 borrowRate = getBorrowRate(e);
   
    // for debug
    uint64 perSecondInterestRateBase1 = perSecondInterestRateBase();
    uint64 perSecondInterestRateSlopeLow1 = perSecondInterestRateSlopeLow();
    uint64 perSecondInterestRateSlopeHigh1 = perSecondInterestRateSlopeHigh();
    uint64 kink1 = kink();

    assert getUtilization(e) == 0 => borrowRate == perSecondInterestRateBase() ;
}
/* 
 Description :  
     if accrue() with lower timestamp sacceeds then acrue with higher timestamp should sacced as well

formula : 
        !lastReverted;

 status : failed
 reason : 
 link https://vaas-stg.certora.com/output/65782/5240447a217a62b1d892/?anonymousKey=cddebb60c69464b5d715c547ab600e08ea032c0c#accrue_not_revertedResults
*/
rule accrue_not_reverted(){
env e1;
env e2;
    setup(e1);
    require e2.msg.value == 0 && e1.msg.value == 0; // reverts if msg.value != 0
    require e2.block.timestamp == e1.block.timestamp + 1;
    require e2.block.timestamp < 2^40; // reverts if block.timestamp > 2^40
    accrue(e1);
    invoke accrue(e2);

    assert !lastReverted;
}


/* 
 Description :  
     if Borrow Base == 0 utilization should equal zero

formula : 
        getTotalBorrowBase(e) == 0 => getUtilization(e) == 0;

 status : proved
 reason : 
 link https://vaas-stg.certora.com/output/65782/6774efcf16e35405da9f/?anonymousKey=686dea1234bd5329ad336ca3f69b59f2ee02cea7
*/
rule borrowBase_vs_utilization(){
env e;
    setup(e);
    assert getTotalBorrowBase(e) == 0 => getUtilization(e) == 0;
}

/* 
 Description :  
     Verifies that isLiquidatable == false can change to true only if getPrice() has changed

formula : 
        isLiquidatable(e2,account) => price1 != price2;

 status : failed
 reason : 
 link https://vaas-stg.certora.com/output/65782/5240447a217a62b1d892/?anonymousKey=cddebb60c69464b5d715c547ab600e08ea032c0c#isLiquidatable_false_should_not_changeResults
*/
rule isLiquidatable_false_should_not_change(address account){
env e1;
env e2;
    require e2.block.timestamp > e1.block.timestamp;
    setup(e1);

    require isLiquidatable(e1,account) == false;
    uint price1 = getPrice(e1,baseTokenPriceFeed(e1));
    uint price2 = getPrice(e2,baseTokenPriceFeed(e2));

    assert isLiquidatable(e2,account) => price1 != price2;
}

/* 
 Description :  
     Verifies that TotalBaseSupplyIndex and getTotalBaseBorrowIndex always greater than baseIndexScale

formula : 
        getTotalBaseSupplyIndex() >= baseIndexScale() &&
        getTotalBaseBorrowIndex() >= baseIndexScale();

 status : proved
 reason : 
 link   : 
*/
rule SupplyIndex_BorrowIndex_GE_baseIndexScale(){
env e;
    setup(e);
    require getTotalBaseSupplyIndex() >= baseIndexScale() &&
        getTotalBaseBorrowIndex() >= baseIndexScale();
    accrue(e);
    assert getTotalBaseSupplyIndex() >= baseIndexScale() &&
        getTotalBaseBorrowIndex() >= baseIndexScale();
}


/* 
 Description :  
     TotalBaseBorrowIndex always greater then  getTotalBaseSupplyIndex

formula : 
        getTotalBaseBorrowIndex() > getTotalBaseSupplyIndex();

 status : timeout
 reason : 
 link   : 
*/
rule SupplyIndex_vs_BorrowIndex(){
env e;
    setup(e);
    require getTotalBaseBorrowIndex() > getTotalBaseSupplyIndex();

    accrue(e);

    assert getTotalBaseBorrowIndex() > getTotalBaseSupplyIndex();
}

/* 
 Description :  
     BorrowRate always greater then SupplyRate

formula : 
        getBorrowRate(e) > getSupplyRate(e);

 status : fail
 reason : Due to rounding down the BorrowRate can become equal to SupplyRate
 link   : https://vaas-stg.certora.com/output/65782/f2f32f50a2bbf14deb79/?anonymousKey=494980dfd3ebcced1ee0d1088acf1a795f9f2a08#SupplyIndex_vs_BorrowIndexResults
*/
rule SupplyRate_vs_BorrowRate(){
env e;
    setup(e);
    require getBorrowRate(e) > getSupplyRate(e);

    accrue(e);

    assert  getBorrowRate(e) > getSupplyRate(e);
}

function setup(env e){
    require getTotalBaseSupplyIndex() >= baseIndexScale() &&
        getTotalBaseBorrowIndex() >= baseIndexScale();
    require getTotalBaseBorrowIndex() > getTotalBaseSupplyIndex();
    // require getBorrowRate(e) > getSupplyRate(e);
    require perSecondInterestRateSlopeLow() > 0 &&
            perSecondInterestRateSlopeLow() < perSecondInterestRateSlopeHigh();
    require reserveRate(e) > 0;
}