import "A_setupNoSummarization.spec"

methods{
    getUserCollateralBalanceByAsset(address, address) returns (uint128) envfree
    call__getPackedAsset(uint8, address, address, uint8, uint64, uint64, uint64 ,uint128) returns (uint256, uint256) envfree
    get_asset00_a() returns (uint256) envfree
    get_asset00_b() returns (uint256) envfree
    0xc8c7fe6b envfree
    exponent_of_ten(uint8) returns (uint64) envfree
}

rule reversability_of_packing(uint8 i, address assetArg, address priceFeedArg, uint8 decimalsArg, uint64 borrowCollateralFactorArg, uint64 liquidateCollateralFactorArg, uint64 liquidationFactorArg, uint128 supplyCapArg){
    require i == 0;
    uint256 word_a; uint256 word_b;
    word_a, word_b = call__getPackedAsset(i, assetArg, priceFeedArg, decimalsArg, borrowCollateralFactorArg, liquidateCollateralFactorArg, liquidationFactorArg, supplyCapArg); 
    uint8 offset_; address asset_; address priceFeed_; uint64 scale_; uint64 borrowCollateralFactor_; uint64 liquidateCollateralFactor_; uint64 liquidationFactor_; uint128 supplyCap_;
    offset_, asset_, priceFeed_, scale_, borrowCollateralFactor_, liquidateCollateralFactor_, liquidationFactor_, supplyCap_ = getAssetInfo(i);
    require word_a == get_asset00_a() && word_b == get_asset00_b();
    assert (asset_ == assetArg && priceFeed_ == priceFeedArg && scale_ == exponent_of_ten(decimalsArg) && borrowCollateralFactor_ == borrowCollateralFactorArg && liquidateCollateralFactor_ == liquidateCollateralFactorArg && liquidationFactor_ == liquidationFactorArg && supplyCap_ == supplyCapArg, "one of the args was corrupted in the process");
}

//assume asset0_a
//assume asset0_b