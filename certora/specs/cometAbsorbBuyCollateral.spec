/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyCometAbsorbBuyCollateral.sh
    On a version with summarization ans some simplifications: 
    CometHarness.sol and setup_cometSummarization.spec

    This file contains properties regarding the two function related to liquidation:
    absorb and buyCollateral 

*/

import "comet.spec"

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  Complete Run: https://vaas-stg.certora.com/output/44289/109d5257e0229a088c11/?anonymousKey=4fe9bb16b23f2292ed7f4bea9eb83991ed3eed93

/*
    @Rule

    @Description: After call to buy collateral:
        balance collateral decrease      &&
        balance Base increase       &&
        balance Base increase IFF balance collateral decrease

    @Formula:
    {
        balanceAssetBefore = tokenBalanceOf(asset, currentContract)
        balanceBaseBefore = tokenBalanceOf(_baseToken, currentContract)
    }
    
    buyCollateral(asset, minAmount, baseAmount, recipient)
    
    {
        tokenBalanceOf(asset, currentContract) <= balanceAssetBefore        &&
        balanceBaseBefore <= tokenBalanceOf(_baseToken, currentContract)    &&
        ( balanceBaseBefore < tokenBalanceOf(_baseToken, currentContract) <=> tokenBalanceOf(asset, currentContract) < balanceAssetBefore )
    }

    @Notes:

    @Link:

*/

rule anti_monotonicity_of_buyCollateral(address asset, uint minAmount, uint baseAmount, address recipient) {
    env e;
    require asset != _baseToken;
    require asset != currentContract; // addition
    require minAmount > 0;
    
    require e.msg.sender != currentContract;
    require recipient != currentContract;
    
    uint256 balanceAssetBefore = tokenBalanceOf(asset, currentContract);
    uint256 balanceBaseBefore = tokenBalanceOf(_baseToken, currentContract);
    buyCollateral(e, asset, minAmount, baseAmount, recipient);
    uint256 balanceAssetAfter = tokenBalanceOf(asset, currentContract);
    uint256 balanceBaseAfter = tokenBalanceOf(_baseToken, currentContract);

    assert (balanceAssetAfter <= balanceAssetBefore);
    assert (balanceBaseBefore <= balanceBaseAfter);
    assert (balanceBaseBefore < balanceBaseAfter <=> balanceAssetAfter < balanceAssetBefore);
}

/*
    @Rule

    @Description:
        After absorb, user's collateral is added to Contract's collateral.
        One cannot buy more collateral than contract's collateral.

    @Formula:
    {
        max = getUserCollateralBalance(currentContract, asset)
        balanceAssetBefore = tokenBalanceOf(asset, currentContract)
    }
    
    buyCollateral(asset, minAmount, baseAmount, recipient)
    
    {
        tokenBalanceOf(asset, currentContract) >= balanceAssetBefore - max
    }

    @Notes:

    @Link:

*/

rule buyCollateral_max(address asset, uint minAmount, uint baseAmount, address recipient) {
    env e;
    require asset != _baseToken; 
    require e.msg.sender != currentContract;
    require recipient != currentContract;
    require asset != currentContract;

    mathint max = getUserCollateralBalance(currentContract, asset);
    uint256 balanceAssetBefore = tokenBalanceOf(asset, currentContract);
    buyCollateral(e, asset, minAmount, baseAmount, recipient);
    uint256 balanceAssetAfter = tokenBalanceOf(asset, currentContract);
    assert (balanceAssetAfter >= balanceAssetBefore - max); 
}


/*
    @Rule

    @Description:
        if the array of accounts has the same account twice then absorb should revert

    @Formula:
    {
        accounts[0] == account && accounts[1] == account
    }
        absorb@withrevert(absorber, accounts)
    {
        lastReverted   
    }

    @Notes: 
        need loop_iter=2 for this rule

    @Link:

*/

rule cannot_absorb_same_account(address absorber, address account) {
    address[] accounts;
    env e;
    require accounts.length == 2;
    require accounts[0] == account;
    require accounts[1] == account;

    absorb@withrevert(e, absorber, accounts);

    assert lastReverted; 
}


/*
    @Rule

    @Description:
        After absorbtion of account, the system's reserves must not increase

    @Formula:
    {
        pre = getReserves()
    }

    absorb(absorber, accounts)
    
    {
        getReserves() <= pre
    }

    @Notes:

    @Link:

*/

rule absorb_reserves_decrease(address absorber, address account) {
    address[] accounts;
    env e;
    simplifiedAssumptions();

    require accounts[0] == account;
    require accounts.length == 1;

    int pre = getReserves(e);
    absorb(e, absorber, accounts);
    int post = getReserves(e);

    assert pre >= post;
}


/*
    @Rule

    @Description:
        on absorb, as the collateral balance increases the total BorrowBase decreases

    @Formula:
    {
        balanceBefore = getUserCollateralBalance(this, asset)
        borrowBefore = getTotalBorrowBase()
    }
    
    absorb()
    
    {
        getUserCollateralBalance(this, asset) > balanceBefore => getTotalBorrowBase() < borrowBefore
    }

    @Notes:

    @Link:
    
*/

rule anti_monotonicity_of_absorb(address absorber, address account) {
    address[] accounts;
    env e;
    simplifiedAssumptions();

    require accounts[0] == account;
    require account != currentContract;
    
    address asset;
   
    uint256 balanceBefore = getUserCollateralBalance(currentContract, asset);
    uint104 borrowBefore = getTotalBorrowBase();

    absorb(e, absorber, accounts);

    uint256 balanceAfter = getUserCollateralBalance(currentContract, asset);
    uint104 borrowAfter = getTotalBorrowBase();
    assert balanceAfter > balanceBefore => borrowAfter < borrowBefore ; 
    
}


/*
    @Rule

    @Description:
        The same account cannot be absorbed repeatedly

    @Formula:
    {
       
    }
    absorb(absorber, accounts); 
    absorb@withrevert(absorber, accounts)
    
    {
        lastReverted 
    }

    @Notes:

    @Link:

*/

rule cannot_double_absorb(address absorber, address account) {
    address[] accounts;
    env e;

    require accounts[0] == account;
    require accounts.length == 1;

    absorb(e, absorber, accounts);
    absorb@withrevert(e, absorber, accounts);

    assert lastReverted; 
}
