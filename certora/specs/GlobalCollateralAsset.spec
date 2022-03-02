import "A_setupNoSummarization.spec"

methods{
    getUserCollateralBalanceByAsset(address, address) returns (uint128) envfree
    call__getPackedAsset(uint8, address, address, uint8, uint64, uint64, uint64 ,uint128) returns (uint256, uint256) envfree
}

rule reversability_of_packing(uint8 i, address assetArg, address priceFeedArg, uint8 decimalsArg, uint64 borrowCollateralFactorArg, uint64 liquidateCollateralFactorArg, uint64 liquidationFactorArg, uint128 supplyCapArg){
    call__getPackedAsset(i, assetArg, priceFeedArg, decimalsArg, borrowCollateralFactorArg, liquidateCollateralFactorArg, liquidationFactorArg, supplyCapArg);
    assert false, "sanity";
}

//assume asset0_a
//assume asset0_b