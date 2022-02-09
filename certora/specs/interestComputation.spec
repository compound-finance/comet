import "A_setupNoSummarization.spec"

methods{
    getSupplyRateInternal() returns (uint64) ;
    getBorrowRateInternal() returns (uint64) ;
    getUtilizationInternal() returns (uint) ;
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
uint64 supplyRate_1 = getSupplyRateInternal();
uint utilization_1 = getUtilizationInternal();
    calldataarg args;
    f(e,args);
uint64 supplyRate_2 = getSupplyRateInternal();
uint utilization_2 = getUtilizationInternal();

assert utilization_2 > utilization_1 => supplyRate_2 > supplyRate_1;
}

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