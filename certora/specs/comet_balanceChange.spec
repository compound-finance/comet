import "B_cometSummarization.spec"

methods {
    call_hasPermission(address, address) returns (bool) envfree
    // getPrincipal(address) returns (int104) envfree
}

function simplifiedAssumptions() {
    env e;
    require getBaseSupplyIndex(e) == getBaseIndexScale(e);
    require getBaseBorrowIndex(e) == getBaseIndexScale(e);
}


