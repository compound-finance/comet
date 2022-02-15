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

//         uint64 baseSupplyIndex;
//         uint64 baseBorrowIndex;
//         uint64 trackingSupplyIndex;
//         uint64 trackingBorrowIndex;
//         // 2nd slot
//         uint104 totalSupplyBase;
//         uint104 totalBorrowBase;
//         uint40 lastAccrualTime;
//         uint8 pauseFlags;
// baseSupplyIndex, baseBorrowIndex, trackingSupplyIndex, trackingBorrowIndex,totalSupplyBase, totalBorrowBase,lastAccrualTime, pauseFlags   =  totalsBasic(e);

// utilization increase implies supplyRate increase
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

rule utilization_LE_factorScale(){
env e;
    setup(e);

uint utilization = getUtilization(e);
    assert utilization <= factorScale();
}
    
rule utilization_zero(){
env e;
    setup(e);

    uint64 borrowRate = getBorrowRate(e);
    // assert getUtilization(e) == 0 => borrowRate == perSecondInterestRateBase();
    // // uint64 perSecondInterestRateBase1 = perSecondInterestRateBase();
    // // uint64 perSecondInterestRateSlopeLow1 = perSecondInterestRateSlopeLow(e);
    // // uint64 perSecondInterestRateSlopeHigh1 = perSecondInterestRateSlopeHigh(e);
    // uint64 kink1 = kink(e);


    assert borrowRate == perSecondInterestRateBase() => getUtilization(e) == 0;
}
    

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



// invariant borrowBase_vs_utilization(env e)
//     getTotalBorrowBase(e) == 0 <=> getUtilization(e) == 0
// {
//     preserved with (env e2){
//     simplify(e2);
//     }
// }
rule borrowBase_vs_utilization(){
env e;
    setup(e);
    assert getTotalBorrowBase(e) == 0 <=> getUtilization(e) == 0;
}
// Verifies that isLiquidatable == false can change to true only if getPrice() has changed
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

//Verifies that TotalBaseSupplyIndex and getTotalBaseBorrowIndex always greater than baseIndexScale
rule SupplyIndex_BorrowIndex_GE_baseIndexScale(){
env e;
    setup(e);
    require getTotalBaseSupplyIndex() >= baseIndexScale() &&
        getTotalBaseBorrowIndex() >= baseIndexScale();
    accrue(e);
    assert getTotalBaseSupplyIndex() >= baseIndexScale() &&
        getTotalBaseBorrowIndex() >= baseIndexScale();
}

//The minimum base token reserves which must be held before collateral is hodled
rule no_reserves_no_borrow(){
    env e;
    setup(e);
    uint104 temp1 = targetReserves();
    mathint target_Reserves = temp1;
    int temp2 = getReserves(e);
    mathint reserves = to_mathint(temp2);

    assert reserves < target_Reserves => getTotalBorrowBase(e) == 0;
}

rule SupplyIndex_vs_BorrowIndex(){
env e;
    setup(e);
    require getTotalBaseBorrowIndex() > getTotalBaseSupplyIndex();

    accrue(e);

    assert getTotalBaseBorrowIndex() > getTotalBaseSupplyIndex();
}

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
}
// run on comet.sol 

// prove and assume:
// baseSupplyIndex >= initial value
// also baseBorrowIndex 

/* check accrue:
a. monotonicity of baseSupplyIndex, baseBorrowIndex
b. rewards
c. more time greater increase in index

low priority: 
d. revert, e1 passes e2 is later in time when does it revert 


e2 < f() => !lastReverted
*/


/* check getSupplyRateInternal
a.
b.

*/


/* signedMulPrice 

mulPrice
*/ 


/* check getBorrowRateInternal




*/

/* check getUtilizationInternal



*/