import "A_setupNoSummarization.spec"

methods{
    call_IsInAsset(uint16, uint8) returns (bool) envfree
    call_updateAssetsIn(address, address, uint128, uint128) envfree
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// simplify - remove mapping, assume global assetIn

// B@B - if a specific asset balance is being updated from 0 to non-0 or vice versa, isInAsset should return the appropriate value
rule check_update_UserCollateral(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    uint16 _assetIn = getAssetinOfUser(account);
    call_updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    uint16 assetIn_ = getAssetinOfUser(account);
    uint8 assetOffset_ = getAssetOffsetByAsset(asset);
    bool flagUserAsset_ = call_IsInAsset(assetIn_, assetOffset_);

    assert (initialUserBalance == 0 && finalUserBalance > 0) => flagUserAsset_, "Balance changed from 0 to non zero, yet the getter retrieve false";
    assert (initialUserBalance > 0 && finalUserBalance == 0) => !flagUserAsset_, "Balance changed from non zero to 0, yet the getter retrieve true";
    // assert ((initialUserBalance == 0 && finalUserBalance > 0) => flagUserAsset_) && ((initialUserBalance > 0 && finalUserBalance == 0) => !flagUserAsset_), "try";
}

// V@V update assetIn changes a single bit - it's impossible that 2 distinct asset bits will be change at the same call to update
rule update_changes_single_bit(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    uint16 _assetIn = getAssetinOfUser(account);
    uint8 assetOffset1;
    uint8 assetOffset2;
    bool _flagUserAsset1 = call_IsInAsset(_assetIn, assetOffset1);
    bool _flagUserAsset2 = call_IsInAsset(_assetIn, assetOffset2);
    
    require assetOffset1 != assetOffset2;
    call_updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    
    uint16 assetIn_ = getAssetinOfUser(account);
    bool flagUserAsset1_ = call_IsInAsset(assetIn_, assetOffset1);
    bool flagUserAsset2_ = call_IsInAsset(assetIn_, assetOffset2);

    assert !(_flagUserAsset1 != flagUserAsset1_ && _flagUserAsset2 != flagUserAsset2_), "2 bits changed at once";
    
    // require assetOffset_ <= 15; // this is an assumption - it will fail it assetOffset

}


// V@V - update assetIn changes the assetIn of a single user - no other users are affected by update.
rule update_changes_single_user_assetIn(address account1, address asset1, uint128 initialUserBalance, uint128 finalUserBalance){
    address account2;
    uint16 _assetIn1 = getAssetinOfUser(account1);
    uint16 _assetIn2 = getAssetinOfUser(account2);
    call_updateAssetsIn(account1, asset1, initialUserBalance, finalUserBalance);
    uint16 assetIn1_ = getAssetinOfUser(account1);
    uint16 assetIn2_ = getAssetinOfUser(account2);

    assert (account1 != account2) => !(_assetIn1 != assetIn1_ && _assetIn2 != assetIn2_), "assetIn changed incorrectly";
}
