import "B_cometSummarization.spec"
methods {
    isInAsset(uint16 assetsIn, uint8 assetOffset) => CONSTANT;
    latestRoundData() returns uint256 => CONSTANT;
    isBorrowCollateralized(address) returns bool envfree
    getUserCollateralBalance(address,address) returns uint128 envfree

    baseToken() returns address envfree
}

rule integrityOfSupply(address from, address dst, address asset, uint amount) {
    env e;
    simplifiedAssumptions();
    require asset != baseToken();
    mathint before = getUserCollateralBalance(dst, asset);
    supplyFrom(e, from, dst, asset, amount);
    assert getUserCollateralBalance(dst, asset) == before + amount;
}

rule whoChangedIsBorrowCollateralized(address account, method f) {
    bool before = isBorrowCollateralized(account);
    env e;
    simplifiedAssumptions();
    calldataarg args;
    f(e,args);
    assert (isBorrowCollateralized(account) == before);
}

rule whoChangedUserCollateralBalance(address account, address asset, method f) {
    mathint before = getUserCollateralBalance(account, asset);
    env e;
    calldataarg args;
    f(e,args);
    assert (getUserCollateralBalance(account,asset) == before);
}

rule sanity(method f) {
	env e;
	calldataarg arg;
	f(e, arg);
	assert false, "this method should have a non reverting path";
}

rule baseSupplyIndex_vs_initialValue(method f){
    env e;
    uint40 time = getNow(e);
uint64 base_supply_index_1 = getTotalBaseSupplyIndex(e);
    calldataarg args;
    f(e,args);
    env e2;
    require getNow(e) > time;
require e2.block.timestamp > e.block.timestamp;
uint64 base_supply_index_2 = getTotalBaseSupplyIndex(e2);

assert base_supply_index_2 > baseIndexScale(e2);
}

rule baseBorrowIndex_vs_initialValue(method f){
    env e;
    uint40 time = getNow(e);
uint64 base_borrow_index_1 = getTotalBaseBorrowIndex(e);
    calldataarg args;
    f(e,args);
    env e2;
    require getNow(e) > time;
require e2.block.timestamp > e.block.timestamp;
uint64 base_borrow_index_2 = getTotalBaseBorrowIndex(e2);

assert base_borrow_index_2 > baseIndexScale(e2);
}

rule check_accrue(method f){
env e;
uint40 time = getNow(e);
uint64 base_supply_index_1 = getTotalBaseSupplyIndex(e);
uint64 base_borrow_index_1 = getTotalBaseBorrowIndex(e);
        uint64 baseSupplyIndex;
        uint64 baseBorrowIndex;
        uint64 trackingSupplyIndex;
        uint64 trackingBorrowIndex;
        // 2nd slot
        uint104 totalSupplyBase;
        uint104 totalBorrowBase;
        uint40 lastAccrualTime;
        uint8 pauseFlags;
baseSupplyIndex, baseBorrowIndex, trackingSupplyIndex, trackingBorrowIndex,totalSupplyBase, totalBorrowBase,lastAccrualTime, pauseFlags   =  totalsBasic(e);
accrue(e);
uint64 base_supply_index_2 = getTotalBaseSupplyIndex(e);
uint64 base_borrow_index_2 = getTotalBaseBorrowIndex(e);

assert base_supply_index_2 >= base_supply_index_1;
assert base_borrow_index_2 >= base_borrow_index_1;
assert getNow(e) > time => base_supply_index_2 > base_supply_index_1;
}

// rule supplyRate_vs_Utilization(method f){
// env e;
// uint64 supplyRate_1 = getSupplyRateInternal(comet.totals());
// uint utilization_1 = getUtilizationInternal();
//     calldataarg args;
//     f(e,args);
// uint64 supplyRate_2 = getSupplyRateInternal();
// uint utilization_2 = getUtilizationInternal();

// assert utilization_2 > utilization_1 => supplyRate_2 > supplyRate_1;
// }

// rule check_accrue_revert(method f){
//     env e;
//     invoke accrue(totals());
// assert !lastReverted;
// }

function simplifiedAssumptions() {
    env e;
    require getTotalBaseSupplyIndex(e) == baseIndexScale(e);
    require getTotalBaseBorrowIndex(e) == baseIndexScale(e);
}
