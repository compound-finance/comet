

// T@T -
rule borrow_then_collateralized(address user, address asset, method f) filtered {f -> !similarFunctions(f) && !f.isView && !f.isFallback} {
    env e;
    simplifiedAssumptions();
    require(getAssetOffsetByAsset(e,asset) == 0);
    isBorrowCollateralized(e, user);
    call_functions_with_specific_asset(f, e, asset);
    isBorrowCollateralized(e, user);
}

