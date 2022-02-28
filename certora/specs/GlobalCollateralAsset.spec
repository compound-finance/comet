import "A_setupNoSummarization.spec"

methods{
    getUserCollateralBalanceByAsset(address, address) returns (uint128) envfree
}

rule reversability_of_packing(uint8 i){
    assert getAssetInfo(i)
}