import "comet.spec"

//  Complete Run: https://vaas-stg.certora.com/output/44289/109d5257e0229a088c11/?anonymousKey=4fe9bb16b23f2292ed7f4bea9eb83991ed3eed93


/*
    @Rule

    @Description: After call to buy collateral:
        balance asset decrease      &&
        balance Base increase       &&
        balance Base increase IFF balance asset decrease
         

    @Formula:
    {
        balanceAssetBefore = tokenBalanceOf(asset, currentContract)
        balanceBaseBefore = tokenBalanceOf(_baseToken, currentContract)
    }
        buyCollateral(asset, minAmount, baseAmount, recipient)
    {
        tokenBalanceOf(asset, currentContract) <= balanceAssetBefore        &&
        balanceBaseBefore <= tokenBalanceOf(_baseToken, currentContract)    &&
        balanceBaseBefore < tokenBalanceOf(_baseToken, currentContract) <=> tokenBalanceOf(asset, currentContract) < balanceAssetBefore
    }

    @Notes:

    @Link:
*/rule antiMonotonicityOfBuyCollateral(address asset, uint minAmount, uint baseAmount, address recipient) {
    env e;
    // https://vaas-stg.certora.com/output/23658/b7cc8ac5bd1d3f414f2f/?anonymousKey=d47ea2a5120f88658704e5ece8bfb45d59b2eb85
    require asset != _baseToken; 
    // if minAmount is not given, one can get zero ?
    //https://vaas-stg.certora.com/output/23658/d48bc0a10849dc638048/?anonymousKey=4162738a94af8200c99d01c633d0eb025fedeaf4
    require minAmount > 0 ; 
    
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
        Can't buy more collateral than contract's collateral (max) 

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

rule buyCollateralMax(address asset, uint minAmount, uint baseAmount, address recipient) {
    env e;
    require asset != _baseToken; 
    require e.msg.sender != currentContract;
    require recipient != currentContract;

    mathint max = getUserCollateralBalance(currentContract, asset);
    uint256 balanceAssetBefore = tokenBalanceOf(asset, currentContract);
    buyCollateral(e, asset, minAmount, baseAmount, recipient);
    uint256 balanceAssetAfter = tokenBalanceOf(asset, currentContract);
    assert (balanceAssetAfter >= balanceAssetBefore - max);
}


/*
    @Rule

    @Description:
        if the array of accounts has ywo similar ones then absorb should revert

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
rule canNot_absorb_same_account(address absorber, address account) {
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
        obsorb()
    {
        getReserves() <= pre
    }

    @Notes:

    @Link:
*/
// V@V - After absorbtion of account, the system's reserves must not increase
rule absorb_reserves_decrease(address absorber, address account) {
    address[] accounts;
    env e;
    simplifiedAssumptions();

    require accounts[0] == account;
    require absorber != account; // might be redundant
    require accounts.length == 1;

    int pre = getReserves();
    absorb(e, absorber, accounts);
    int post = getReserves();

    assert pre >= post;
}


/*
    @Rule

    @Description:
        as the collateral balance increases the BorrowBase decreases

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
rule antiMonotonicityOfAbsorb(address absorber, address account) {
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
        absorb(absorber, accounts); //success
    }
        absorb@withrevert(absorber, accounts);
    {
        lastReverted; //last call to absorb always reverts
    }

    @Notes:

    @Link:
*/
rule canNot_double_absorb(address absorber, address account) {
    address[] accounts;
    env e;

    require accounts[0] == account;
    require absorber != account; // might be redundant
    require accounts.length == 1;

    absorb(e, absorber, accounts);
    absorb@withrevert(e, absorber, accounts);

    assert lastReverted; 
}
