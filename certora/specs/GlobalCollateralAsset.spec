import "A_setupNoSummarization.spec"

methods{
    getUserCollateralBalanceByAsset(address, address) returns (uint128) envfree
}

rule reversability_of_packing(uint8 i){
}

//assume asset0_a
//assume asset0_b