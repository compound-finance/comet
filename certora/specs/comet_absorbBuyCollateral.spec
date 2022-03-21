import "comet.spec"


rule antiMonotonicityOfBuyCollateral(address asset, uint minAmount, uint baseAmount, address recipient) {
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


// note - need loop_iter=2 for this rule
// T@T - The same account cannot be absorbed twice
rule canNot_absorb_same_account(address absorber, address account) {
    address[] accounts;
    env e;
    require accounts.length == 2;
    require accounts[0] == account;
    require accounts[1] == account;

    absorb@withrevert(e, absorber, accounts);

    assert lastReverted; 
}


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


// T@T - In case of absorbtion, if the balance of a collateral asset increase in the system, then the total borrow of users is decreased
rule antiMonotonicityOfAbsorb(address absorber, address account) {
    address[] accounts;
    env e;
    simplifiedAssumptions();

    require accounts[0] == account;
    
    address asset;
    uint256 balanceBefore = getUserCollateralBalance(account, currentContract);
    uint104 borrowBefore = getTotalBorrowBase();

    absorb(e, absorber, accounts);

    uint256 balanceAfter = getUserCollateralBalance(account, currentContract);
    uint104 borrowAfter = getTotalBorrowBase();
    assert balanceAfter > balanceBefore => borrowAfter < borrowBefore ; 
    
}


// V@V - The same account cannot be absorbed after already absorbed
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
