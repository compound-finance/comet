import "comet.spec"

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

function simplifiedAssumptions() {
    env e;
    require getTotalBaseSupplyIndex(e) == baseIndexScale(e);
    require getTotalBaseBorrowIndex(e) == baseIndexScale(e);
}