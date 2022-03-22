import "A_setupNoSummarization.spec"

methods{
    call_isInAsset(uint16, uint8) returns (bool) envfree
    call_updateAssetsIn(address, address, uint128, uint128) envfree
    assetsInOfUser() envfree // temp, needs to be removed
    updateAssetsIn2(address, uint128, uint128) envfree
    isInAsset2(uint16, uint8) returns (bool) envfree
}


// B@B - if a specific asset balance is being updated from 0 to non-0 or vice versa, isInAsset should return the appropriate value
rule check_update_UserCollateral_red(address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    uint16 _assetIn = assetsInOfUser();
    updateAssetsIn2(asset, initialUserBalance, finalUserBalance);
    uint16 assetIn_ = assetsInOfUser();
    uint8 assetOffset_ = getAssetOffsetByAsset(asset);
    bool flagUserAsset_ = isInAsset2(assetIn_, assetOffset_);

    // assert (initialUserBalance == 0 && finalUserBalance > 0) => flagUserAsset_, "Balance changed from 0 to non zero, yet the getter retrieve false";
    // assert (initialUserBalance > 0 && finalUserBalance == 0) => !flagUserAsset_, "Balance changed from non zero to 0, yet the getter retrieve trueenvfree";
    assert ((initialUserBalance == 0 && finalUserBalance > 0) => flagUserAsset_) && ((initialUserBalance > 0 && finalUserBalance == 0) => !flagUserAsset_), "try";
}