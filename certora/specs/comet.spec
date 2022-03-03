import "B_cometSummarization.spec"
import "erc20.spec"


using SymbolicBaseToken as _baseToken 


methods {
    //temporary under approximations
    // isInAsset(uint16 assetsIn, uint8 assetOffset) => CONSTANT;
    latestRoundData() returns uint256 => DISPATCHER(true);

    //todo - move to setup?
    isBorrowCollateralized(address) returns bool envfree
    getUserCollateralBalance(address,address) returns uint128 envfree

    baseToken() returns address envfree
    getTotalSupplyBase() returns (uint104) envfree
    getTotalBorrowBase() returns (uint104) envfree 
    getTotalsSupplyAsset(address asset) returns (uint128) envfree  
    getReserves() returns (int) envfree
    targetReserves() returns (uint104) envfree

    _baseToken.balanceOf(address account) returns (uint256) envfree

    getUserCollateralBalanceByAsset(address, address) returns uint128 envfree
    call_Summarized_IsInAsset(uint16, uint8) returns (bool) envfree
    getAssetinOfUser(address) returns (uint16) envfree
    asset_index(address) returns (uint8) envfree
    tokenBalanceOf(address, address) returns uint256 envfree 
}

definition similarFunctions(method f) returns bool =    
            f.selector == withdraw(address,uint256).selector ||
            f.selector == withdrawTo(address,address,uint).selector ||
            f.selector == transferAsset(address,address,uint).selector ||
            f.selector == supplyTo(address,address,uint).selector ||
            f.selector == supply(address,uint).selector ;




ghost mathint sumUserBasicPrinciple  {
	init_state axiom sumUserBasicPrinciple==0; 
}

ghost mapping( address => mathint) sumBalancePerAssert {
    init_state axiom forall address t. sumBalancePerAssert[t]==0;
}


hook Sstore userBasic[KEY address a].principal int104 balance
    (int104 old_balance) STORAGE {
  sumUserBasicPrinciple  = sumUserBasicPrinciple +
      to_mathint(balance) - to_mathint(old_balance);
}

hook Sstore userCollateral[KEY address account][KEY address t].balance  uint128 balance (uint128 old_balance) STORAGE {
    sumBalancePerAssert[t] = sumBalancePerAssert[t] - old_balance + balance;
}

////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////   Michael   /////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

/* move to comet an use summarization */

// B@B - assetIn of a specific asset is initialized (!0) or uninitialized (0) along with the collateral balance
rule assetIn_Initialized_With_Balance(method f, address user, address asset) filtered { f -> f.selector != call_updateAssetsIn(address, address, uint128, uint128).selector } {
    env e; calldataarg args;
    require getUserCollateralBalanceByAsset(user, asset) == 0 <=> call_Summarized_IsInAsset(getAssetinOfUser(user), asset_index(asset));
    f(e, args);
    assert getUserCollateralBalanceByAsset(user, asset) == 0 <=> call_Summarized_IsInAsset(getAssetinOfUser(user), asset_index(asset));
}
// balance change => update asset


/*

Description: 
        Summary of balances (base):
formula: 
        sum(userBasic[u].principal) == totalsBasic.totalSupplyBase - totalsBasic.totalBorrowBase
status:

*/
invariant totalBaseToken() 
	sumUserBasicPrinciple == to_mathint(getTotalSupplyBase()) - to_mathint(getTotalBorrowBase()) filtered { f-> !similarFunctions(f) && !f.isView }
{
    preserved {
        simplifiedAssumptions();
    }
}



/* 
 Description :  
        The sum of collateral per asset over all users is equal to total collateral of asset:

formula : 
        sum(userCollateral[u][asset].balance) == totalsCollateral[asset].totalSupplyAsset

 status : proved 
 link https://vaas-stg.certora.com/output/23658/c653b4018c776983368a?anonymousKey=ed01d8a8a20618fae0c3e40f1e1e3a99c2a253e8
*/
invariant totalCollateralPerAsset(address asset) 
    sumBalancePerAssert[asset] == getTotalsSupplyAsset(asset)     
    filtered { f-> !similarFunctions(f) && !f.isView }
    {
        preserved {
            simplifiedAssumptions();
        }
    }

/* 
 Description :  
        for each asset, the contract's balance is at least as the total supply 
formula : 
        totalsCollateral[asset].totalSupplyAsset == asset.balanceOf(this)
*/
invariant totalCollateralPerAssetVsAssetBalance(address asset) 
        getTotalsSupplyAsset(asset)  <= tokenBalanceOf(asset, currentContract) 
        filtered { f-> !similarFunctions(f) && !f.isView }


function simplifiedAssumptions() {
    env e;
    require getTotalBaseSupplyIndex(e) == baseIndexScale(e);
    require getTotalBaseBorrowIndex(e) == baseIndexScale(e);
    require _baseToken.balanceOf(currentContract) == getTotalSupplyBase() - getTotalBorrowBase();
}

/* 
 Description :  
        Can withdraw all contract's balance without revert

 formula : 
        withdraw(msg.sender, baseToken.balanceOf(currentContract)) -> no revert

 status : proved
 reason :
 link   : 
*/

rule withdraw_all_balance(){
    env e;
    simplifiedAssumptions();
    uint256 balance = _baseToken.balanceOf(currentContract);
    withdraw(e,e.msg.sender,balance);
    assert false;
}

/* 
 Description :  
        when contract balance == 0 , reserves should be LE zero

 formula : 
        _baseToken.balanceOf(currentContract) == 0 => getReserves() <= 0

 status : proved
 reason :
 link   :
*/
invariant no_reserves_zero_balance()
_baseToken.balanceOf(currentContract) == 0 => getReserves() <= 0
filtered { f-> !similarFunctions(f) && !f.isView }
    {
        preserved {
            simplifiedAssumptions();
        }
    }
/* 
 Description :  
        Due to summarization the following should hold

 formula : 
        baseToken.balanceOf(currentContract) == getTotalSupplyBase() - getTotalBorrowBase()

 status : failed
 reason :
 link   : 
*/
invariant base_balance_vs_totals()
_baseToken.balanceOf(currentContract) == getTotalSupplyBase() - getTotalBorrowBase()
filtered { f-> !similarFunctions(f) && !f.isView }
    {
        preserved {
            simplifiedAssumptions();
        }
    }

rule additivity_of_withdraw( uint x, uint y){
    env e;
    storage init = lastStorage;
    
    simplifiedAssumptions();
    require x + y < 2^255;

    withdraw(e,_baseToken, x);
    int104 baseX = baseBalanceOf(e,e.msg.sender);
    withdraw(e,_baseToken, y);
    int104 baseY = baseBalanceOf(e,e.msg.sender);
    withdraw(e,_baseToken, x + y) at init;
    int104 baseXY = baseBalanceOf(e,e.msg.sender);

    assert baseXY == baseY;
}

// rule withdraw_min(){
//     env e;
//     withdraw(e,e.msg.sender,)
// }

rule usage_registered_assets_only(address asset) {
    assert false, "todo";
}

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


rule withdraw_reserves(address to){
    env e;

    uint amount1;
    uint amount2;
    require amount2 > amount1;    
    
    storage init = lastStorage;
    
    require to != currentContract && amount1 > 0;

    withdrawReserves(e,to,amount1);
        int reserves1 = getReserves();
    withdrawReserves(e,to,amount2) at init;
        int reserves2 = getReserves();

    assert reserves1 > reserves2;
}


rule withdraw_reserves_decreases(address to, uint amount){
    env e;

    int256 before = getReserves();
    withdrawReserves(e,to,amount);
    int256 after = getReserves();

    assert amount >0 && to != currentContract => before > after;
}


rule verify_isBorrowCollateralized(address account){
    env e;

    storage init = lastStorage;
    
    bool collateralized1 = isBorrowCollateralized(account);
        accrue(e) at init;
    bool collateralized2 = isBorrowCollateralized(account);

    assert collateralized1 == collateralized1;
}

rule supply_increase_balance(uint amount){
    env e;

    simplifiedAssumptions();

    uint balance1 = _baseToken.balanceOf(currentContract);
    supply(e,_baseToken,amount);
    uint balance2 = _baseToken.balanceOf(currentContract);
    
    assert balance2 - balance1 == amount;
}

rule withdraw_decrease_balance(address asset, uint amount){
    env e;

    simplifiedAssumptions();

    uint balance1 = _baseToken.balanceOf(currentContract);
    withdraw(e,_baseToken,amount);
    uint balance2 = _baseToken.balanceOf(currentContract);
    
    assert balance1 - balance2 == amount;
}

rule call_absorb(address absorber, address account) {
    address[] accounts;
    env e;

    require accounts[0] == account;
    require absorber != account;
    require accounts.length == 1;

    absorb(e, absorber, accounts);
    absorb(e, absorber, accounts);

    assert false; 
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

rule absorb_reserves_increas(address absorber, address account) {
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
