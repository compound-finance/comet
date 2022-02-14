import "A_setupNoSummarization.spec"

methods{
    call_IsInAsset(uint16, uint8) returns (bool)
    call_updateAssetsIn(address, address, uint128, uint128)
    // call__getPackedAsset(AssetConfig[], uint) returns (uint256, uint256)
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// ghost mapping(address => uint8) asset_Index_Ghost

// invariant asset_position_in_array_doesnt_change(address asset, )


invariant check_flag_updates(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance)
    finalUserBalance == 0 => !call_isInAsset(assetsIn, ) &&
    finalUserBalance != 0 => call_isInAsset(assetsIn, )
    filtered { f -> f.selector == call_updateAssetsIn(address, address, uint128, uint128).selector }
    

/*
// updateAssetsIn changes the assetIn only if either the initial or the final sum is 0
rule check_flag_updates(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    env e; calldataarg args;
    uint16 assetsIn = getAssetinOfUser(account);
    call_updateAssetsIn(e, account, asset, initialUserBalance, finalUserBalance);
    assert (initialUserBalance != 0 && finalUserBalance == 0) => !call_isInAsset(assetsIn, );
    assert (initialUserBalance == 0 && finalUserBalance != 0) => call_isInAsset(assetsIn, );
}
*/

/*
// checks the integrity of getters  - after an update the getters retrieve same values as 
rule check_flag_getters(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused){
    env e;
    pause@withrevert(e, supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused);
    bool isRevert = lastReverted;
    bool flagSupply_ = isSupplyPaused();
    bool flagTransfer_ = isTransferPaused();
    bool flagWithdraw_ = isWithdrawPaused();
    bool flagAbsorb_ = isAbsorbPaused();
    bool flagBuy_ = isBuyPaused();
    assert !isRevert => flagSupply_ == supplyPaused, "supply flag update done wrongfully";
    assert !isRevert => flagTransfer_ == transferPaused, "transfer flag update done wrongfully";
    assert !isRevert => flagWithdraw_ == withdrawPaused, "withdraw flag update done wrongfully";
    assert !isRevert => flagAbsorb_ == absorbPaused, "absorb flag update done wrongfully";
    assert !isRevert => flagBuy_ == buyPaused, "buy flag update done wrongfully";
}
*/