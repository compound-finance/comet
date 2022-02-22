import "A_setupNoSummarization.spec"

methods{
    call_IsInAsset(uint16, uint8) returns (bool) envfree
    call_updateAssetsIn(address, address, uint128, uint128) envfree
    getUserCollateralBalanceByAsset(address, address) returns (uint128) envfree
    calc_power_of_two(uint8) returns (uint256) envfree

    // call__getPackedAsset(AssetConfig[], uint) returns (uint256, uint256)
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

/* move to comet an use summarization */

// B@B - assetIn of a specific asset is initialized (!0) or uninitialized (0) along with the collateral balance
invariant assetIn_Initialized_With_Balance(address user, address asset)
    getUserCollateralBalanceByAsset(user, asset) == 0 <=> call_IsInAsset(getAssetinOfUser(user), getAssetOffsetByAsset(asset))
    filtered { f -> f.selector != call_updateAssetsIn(address, address, uint128, uint128).selector }

// balance change => update asset

// V@V - if a specific asset balance is being updated from 0 to non-0 or vice versa, isInAsset should return the appropriate value
rule check_update_UserCollater(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    call_updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    uint16 assetIn_ = getAssetinOfUser(account);
    uint8 assetOffset_ = getAssetOffsetByAsset(asset);
    bool flagUserAsset_ = call_IsInAsset(assetIn_, assetOffset_);

    assert finalUserBalance > 0 && initialUserBalance == 0 => flagUserAsset_, "Balance changed from 0 to non zero, yet the getter retrieve false";
    assert finalUserBalance == 0 && initialUserBalance > 0 => !flagUserAsset_, "Balance changed from non zero to 0, yet the getter retrieve true";
}


// B@B update assetIn changes a single bit. It is checked by change in numerical value of uint16 assetIn
rule update_changes_single_bit(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    uint16 _assetIn = getAssetinOfUser(account);
    uint8 assetOffset1;
    uint8 assetOffset2;
    bool _flagUserAsset1 = call_IsInAsset(_assetIn, assetOffset1);
    bool _flagUserAsset2 = call_IsInAsset(_assetIn, assetOffset2);
    call_updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    uint16 assetIn_ = getAssetinOfUser(account);
    bool flagUserAsset1_ = call_IsInAsset(assetIn_, assetOffset1);
    bool flagUserAsset2_ = call_IsInAsset(assetIn_, assetOffset2);

    assert !(_flagUserAsset1 != flagUserAsset1_ && _flagUserAsset2 != flagUserAsset2_), "2 bits changed at once";
    
    // require assetOffset_ <= 15; // this is an assumption - it will fail it assetOffset

}

/*
// update assetIn changes a single bit. It is checked by change in numerical value of uint16 assetIn
rule update_changes_single_user_assetIn(address account1, address asset1, uint128 initialUserBalance, uint128 finalUserBalance){
    address account2;
    uint16 _assetIn = getAssetinOfUser(account);
    call_updateAssetsIn(account1, asset1, initialUserBalance, finalUserBalance);
    uint16 assetIn_ = getAssetinOfUser(account);
    uint8 assetOffset_ = getAssetOffsetByAsset(asset);
    bool flagUserAsset_ = call_IsInAsset(assetIn_, assetOffset_);

    // require assetOffset_ <= 15; // this is an assumption - it will fail it assetOffset 

    assert (finalUserBalance > 0 && initialUserBalance == 0 && (_assetIn != assetIn_)) => (assetIn_ == _assetIn + (calc_power_of_two(assetOffset_))), "assetIn changed incorrectly";
    assert (finalUserBalance == 0 && initialUserBalance > 0 && (_assetIn != assetIn_)) => (assetIn_ == _assetIn - (calc_power_of_two(assetOffset_))), "assetIn changed incorrectly";
}
*/