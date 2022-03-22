import "A_setupNoSummarization.spec"

methods{
    getUserCollateralBalance(address, address) returns (uint128) envfree
    call_getPackedAsset(uint8, address, address, uint8, uint64, uint64, uint64 ,uint128) returns (uint256, uint256) envfree
    getAsset00_a() returns (uint256) envfree
    getAsset00_b() returns (uint256) envfree
    0xc8c7fe6b envfree
    powerOfTen(uint8) returns (uint64) envfree
}

rule reversability_of_packing(uint8 i, address assetArg, address priceFeedArg, uint8 decimalsArg, uint64 borrowCollateralFactorArg, uint64 liquidateCollateralFactorArg, uint64 liquidationFactorArg, uint128 supplyCapArg){
    require i == 0; // checking for the 1st asset only, assuming that the retrival of the correct asset in _getAssetConfig being done correctly
    uint256 word_a; uint256 word_b;
    word_a, word_b = call_getPackedAsset(i, assetArg, priceFeedArg, decimalsArg, borrowCollateralFactorArg, liquidateCollateralFactorArg, liquidationFactorArg, supplyCapArg); 
    uint8 offset_; address asset_; address priceFeed_; uint64 scale_; uint64 borrowCollateralFactor_; uint64 liquidateCollateralFactor_; uint64 liquidationFactor_; uint128 supplyCap_;
    offset_, asset_, priceFeed_, scale_, borrowCollateralFactor_, liquidateCollateralFactor_, liquidationFactor_, supplyCap_ = getAssetInfo(i);
    require word_a == getAsset00_a() && word_b == getAsset00_b(); // assumtion that assetXX_a, assetXX_b are being loaded with correct value
    if (assetArg == 0 ){
        assert (asset_ == assetArg, "asset is non-zero");
        assert (priceFeed_ == 0, "price feed is non-zero");
        assert (scale_ == 10^0, "scale is not 1");
        assert (borrowCollateralFactor_ == 0, "borrow Collateral Factor is non-zero");
        assert (liquidateCollateralFactor_ == 0, "liquidate Collateral Factor is non-zero");
        assert (liquidationFactor_ == 0, "liquidation Factor is non-zero");
        assert (supplyCap_ == 0, "supply cap is non-zero");
    }
    else{
        assert (asset_ == assetArg, "asset got packed/unpacked wrongfully");
        assert (priceFeed_ == priceFeedArg, "price feed got packed/unpacked wrongfully");
        assert (scale_ == powerOfTen(decimalsArg), "decimals got packed/unpacked wrongfully");
        assert (borrowCollateralFactor_ == borrowCollateralFactorArg, "borrow collateral factor got packed/unpacked wrongfully");
        assert (liquidateCollateralFactor_ == liquidateCollateralFactorArg, "liquidation collateral factor got packed/unpacked wrongfully");
        assert (liquidationFactor_ == liquidationFactorArg, "liquidation factor got packed/unpacked wrongfully");
        assert (supplyCap_ == supplyCapArg, "supply got packed/unpacked wrongfully");
    }
}
