import "A_setupNoSummarization.spec"

methods{
    call_IsInAsset(uint16, uint8) returns (bool) envfree
    call_updateAssetsIn(address, address, uint128, uint128) envfree
    getUserCollateralBalanceByAsset(address, address) returns (uint128) envfree

    // call__getPackedAsset(AssetConfig[], uint) returns (uint256, uint256)
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// V@V - assetIn of a specific asset is initialized (!0) or uninitialized (0) along with the collateral balance
invariant assetIn_Initialized_With_Balance(address user, address asset)
    getUserCollateralBalanceByAsset(user, asset) == 0 <=> call_IsInAsset(getAssetinOfUser(user), getAssetOffsetByAsset(asset))
    filtered { f -> f.selector != call_updateAssetsIn(address, address, uint128, uint128).selector }


// V@V - if a specific asset balance is being updated from 0 to non-0 or vice versa, isInAsset should return the appropriate value
rule check_update_UserCollater(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    call_updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    uint16 assetIn_ = getAssetinOfUser(account);
    uint8 assetOffset_ = getAssetOffsetByAsset(asset);
    bool flagUserAsset_ = call_IsInAsset(assetIn_, assetOffset_);

    assert finalUserBalance > 0 && initialUserBalance == 0 => flagUserAsset_, "Balance changed from 0 to non zero, yet the getter retrieve false";
    assert finalUserBalance == 0 && initialUserBalance > 0 => !flagUserAsset_, "Balance changed from non zero to 0, yet the getter retrieve true";
}

// update assetIn changes a single bit. It is checked by change in numerical value of uint16 assetIn
rule update_changes_single_bit(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    uint16 _assetIn = getAssetinOfUser(account);
    call_updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    uint16 assetIn_ = getAssetinOfUser(account);
    uint8 assetOffset_ = getAssetOffsetByAsset(asset);
    bool flagUserAsset_ = call_IsInAsset(assetIn_, assetOffset_);

    // require assetOffset_ <= 15; // this is an assumption - it will fail it assetOffset 

    assert (finalUserBalance > 0 && initialUserBalance == 0 && (_assetIn != assetIn_)) => (assetIn_ == _assetIn - (2 ^ assetOffset_)), "assetIn changed incorrectly ";
    assert (finalUserBalance == 0 && initialUserBalance > 0 && (_assetIn != assetIn_)) => (assetIn_ == _assetIn + (2 ^ assetOffset_)), "assetIn changed incorrectly";
}


/*
// checks the integrity of isInAsset  - after an update the getters retrieve expected values as 
rule check_flag_getter(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    env e;
    updateAssetsIn(e, account, asset, initialUserBalance, finalUserBalance);
    uint16 assetIn = getAssetinOfUser(account);
    bool flagUserAsset_ = isInAsset(assetIn, offset);
    
    
    assert flagUserAsset_ <=> finalUserBalance != 0, "Asset getter is being done wrongfully";
}
*/