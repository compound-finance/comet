import "A_setupNoSummarization.spec"

methods{
    getSpecificSupplyRateInternal(uint64,uint64,uint64,uint64) returns (uint64) envfree;
    getSpecificBorrowRateInternal(uint64,uint64,uint64,uint64) returns (uint64) envfree;
    getSpecificUtilizationInternal(uint64,uint64,uint64,uint64) returns (uint)  envfree;

    getTotalBaseSupplyIndex() returns (uint64) envfree;
    getTotalBaseBorrowIndex() returns (uint64) envfree;
    getlastAccrualTime() returns (uint40) envfree;
}

rule SupplyIndex_BorrowIndex_rise_with_time(method f){
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

rule SupplyIndex_BorrowIndex_monotonic(method f){
    env e;
    uint64 base_supply_index_1 = getTotalBaseSupplyIndex();
    uint64 base_borrow_index_1 = getTotalBaseBorrowIndex();
    calldataarg args;
    f(e,args);
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

rule supplyRate_vs_Utilization(method f){
env e;
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
    // calldataarg args;
    // f(e,args);
uint64 supplyRate_2 = getSpecificSupplyRateInternal(baseSupplyIndex2,baseBorrowIndex2,trackingSupplyIndex2,trackingBorrowIndex2);
uint utilization_2 = getSpecificUtilizationInternal(baseSupplyIndex2,baseBorrowIndex2,trackingSupplyIndex2,trackingBorrowIndex2);

    assert utilization_2 > utilization_1 => supplyRate_2 > supplyRate_1;
}

invariant utilization_LE_factorScale(uint64 baseSupplyIndex,uint64 baseBorrowIndex,uint64 trackingSupplyIndex,uint64 trackingBorrowIndex)
getSpecificUtilizationInternal(baseSupplyIndex,baseBorrowIndex,trackingSupplyIndex,trackingBorrowIndex) <= factorScale()

// rule check_accrue_revert(method f){
//     env e;
//     invoke accrue(totals());
// assert !lastReverted;
// }


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