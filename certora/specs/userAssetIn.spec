/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyUserAssetIn.sh

    This file contains rules related to storing the collateral assets of a user.
*/

import "setup_noSummarization.spec"

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Methods Declarations   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

methods{
    call_isInAsset(uint16, uint8) returns (bool) envfree
    call_updateAssetsIn(address, address, uint128, uint128) envfree
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/e04f799f478e41c5ee2b/?anonymousKey=8dd81a5b173bc72bd7c358f861c42db9ea9ba0dd

/*
    @Rule

    @Description:
        If a specific asset balance is being updated from 0 to non-0 or vice versa, isInAsset should return the appropriate value

    @Formula:
        {
            _assetIn = getAssetinOfUser(account)
        }
        
        updateAssetsIn(account, asset, initialUserBalance, finalUserBalance)

        {
            assetIn_ = getAssetinOfUser(account) &&
            assetOffset_ = getAssetOffsetByAsset(asset) &&
            flagUserAsset_ = call_isInAsset(assetIn_, assetOffset_) &&
            (initialUserBalance == 0 && finalUserBalance > 0) => flagUserAsset_ &&
            (initialUserBalance > 0 && finalUserBalance == 0) => !flagUserAsset_
        }

    @Note:
        
    @Link:
        
*/

// B@B - The rule at its current state should fail with a violation of offset > 15 (will not change any asset).
// The rule at the moement pass for no good reason. When things get fixed and it fails for the mentioned reason,
// the commented require below can be added to make the rule pass correctly
rule check_update_UserCollateral(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    uint16 _assetIn = getAssetinOfUser(account);
    call_updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    uint16 assetIn_ = getAssetinOfUser(account);
    uint8 assetOffset_ = getAssetOffsetByAsset(asset);
    bool flagUserAsset_ = call_isInAsset(assetIn_, assetOffset_);

    assert (initialUserBalance == 0 && finalUserBalance > 0) => flagUserAsset_, "Balance changed from 0 to non zero, yet the getter retrieve false";
    assert (initialUserBalance > 0 && finalUserBalance == 0) => !flagUserAsset_, "Balance changed from non zero to 0, yet the getter retrieve true";
}

/*
    @Rule

    @Description:
        Update assetIn changes a single bit - it's impossible that 2 distinct asset bits will be change at the same call to update

    @Formula:
    {          
        _flagUserAsset1 = isInAsset(userBasic[user].assetsIn, assetOffset1) &&
        _flagUserAsset2 = isInAsset(userBasic[user].assetsIn, assetOffset2) &&
        assetOffset1 != assetOffset2
    }

        updateAssetsIn(account, asset, initialUserBalance, finalUserBalance)

    {
        isInAsset(userBasic[user].assetsIn, assetOffset1) = _flagUserAsset1  ||
        isInAsset(userBasic[user].assetsIn, assetOffset2) = _flagUserAsset2 
    }    

    @Note:

    @Link:
        
*/

rule update_changes_single_bit(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance){
    uint16 _assetIn = getAssetinOfUser(account);
    uint8 assetOffset1;
    uint8 assetOffset2;
    bool _flagUserAsset1 = call_isInAsset(_assetIn, assetOffset1);
    bool _flagUserAsset2 = call_isInAsset(_assetIn, assetOffset2);
    
    require assetOffset1 != assetOffset2;
    call_updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    
    uint16 assetIn_ = getAssetinOfUser(account);
    bool flagUserAsset1_ = call_isInAsset(assetIn_, assetOffset1);
    bool flagUserAsset2_ = call_isInAsset(assetIn_, assetOffset2);

    assert !(_flagUserAsset1 != flagUserAsset1_ && _flagUserAsset2 != flagUserAsset2_), "2 bits changed at once";
}

/*
    @Rule

    @Description:
        Update assetIn changes the assetIn of a single user - no other users are affected by update.

    @Formula:
   {
        other != user &&
        assetIn = userBasic[other].assetsIn
    }

        updateAssetsIn(account, asset, initialUserBalance, finalUserBalance)

    {
         userBasic[other].assetsIn != assetIn 
    }
    @Note:
        
    @Link:
        
*/

rule update_changes_single_user_assetIn(address account1, address asset1, uint128 initialUserBalance, uint128 finalUserBalance){
    address account2;
    uint16 _assetIn1 = getAssetinOfUser(account1);
    uint16 _assetIn2 = getAssetinOfUser(account2);
    call_updateAssetsIn(account1, asset1, initialUserBalance, finalUserBalance);
    uint16 assetIn1_ = getAssetinOfUser(account1);
    uint16 assetIn2_ = getAssetinOfUser(account2);

    assert (account1 != account2) => !(_assetIn1 != assetIn1_ && _assetIn2 != assetIn2_), "assetIn changed incorrectly";
}
