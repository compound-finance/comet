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

    uint256 balanceAssetBefore = tokenBalanceOf(asset, currentContract);
    buyCollateral(e, asset, minAmount, baseAmount, recipient);
    uint256 balanceAssetAfter = tokenBalanceOf(asset, currentContract);
    assert (balanceAssetBefore > 0 => balanceAssetAfter > 0);
}


// note - need loop_iter=2 for this rule
rule call_absorb_2(address absorber, address account1, address account2) {
    address[] accounts;
    env e;

    require absorber != account1 && absorber != account2;
    require accounts.length == 2;

    require account1 == account2;

    require accounts[0] == account1;
    require accounts[1] == account2;

    absorb(e, absorber, accounts);

    assert false; 
}

rule absorb_reserves_increase(address absorber, address account) {
    address[] accounts;
    env e;

    require accounts[0] == account;
    require absorber != account;
    require accounts.length == 1;

    int pre = getReserves();
    absorb(e, absorber, accounts);
    int post = getReserves();

    assert pre >= post; 
}

rule buyCol_then_withdraw(address account, uint amount){
    env e;
    require e.msg.sender != currentContract;
    
    storage init = lastStorage;

    address asset; address recipient;
    uint minAmount; uint baseAmount;
    require asset != currentContract && recipient != currentContract;

    withdraw(e, account, amount);
    buyCollateral(e, asset, minAmount, baseAmount, recipient) at init;
    invoke withdraw(e, account, amount);

    assert !lastReverted;
}

rule canNot_double_absorb(address absorber, address account) {
    address[] accounts;
    env e;

    require accounts[0] == account;
    require absorber != account;
    require accounts.length == 1;

    absorb(e, absorber, accounts);
    absorb@withrevert(e, absorber, accounts);

    assert lastReverted; 
}
