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
    targetReserves() returns (uint256) envfree
    initializeStorage() 

    _baseToken.balanceOf(address account) returns (uint256) envfree

    getUserCollateralBalanceByAsset(address, address) returns uint128 envfree
    call_Summarized_IsInAsset(uint16, uint8) returns (bool) envfree
    getAssetinOfUser(address) returns (uint16) envfree
    asset_to_index(address) returns (uint8) envfree
    index_to_asset(uint8) returns (address) envfree
    tokenBalanceOf(address, address) returns uint256 envfree 
}


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

function call_functions_with_specific_asset(method f, env e, address asset) returns uint{
    address _account; uint amount; address account_; uint minAmount;
    address[] accounts_array;
	/*if (f.selector == collateralBalanceOf(address, address).selector) {
        uint128 balance = collateralBalanceOf(e, _account, asset);
        return balance;
	} else */if (f.selector == supply(address, uint).selector) {
        supply(e, asset, amount);
	} else if (f.selector == supplyTo(address, address, uint).selector) {
        supplyTo(e, account_, asset, amount);
	} else if  (f.selector == supplyFrom(address, address, address, uint).selector) {
        supplyFrom(e, _account, account_, asset, amount);
	} else if (f.selector == transferAsset(address, address, uint).selector) {
        transferAsset(e, account_, asset, amount);
	} else if (f.selector == transferAssetFrom(address, address, address, uint).selector) {
        transferAssetFrom(e, _account, account_, asset, amount);
	} else if (f.selector == withdraw(address, uint).selector) {
        withdraw(e, asset, amount);
	} else if (f.selector == withdrawTo(address, address, uint).selector) {
        withdrawTo(e, account_, asset, amount);
	} else if (f.selector == withdrawFrom(address, address, address, uint).selector) {
        withdrawFrom(e, _account, account_, asset, amount);
	} else if (f.selector == absorb(address, address[]).selector) {
        absorb(e, _account, accounts_array);
	} else if (f.selector == buyCollateral(address, uint, uint, address).selector) {
        buyCollateral(e, asset, minAmount, amount, account_);
	} else if (f.selector == quoteCollateral(address, uint).selector) {
        uint price = quoteCollateral(e, asset, amount);
        return price;
	} else if (f.selector == withdrawReserves(address, uint).selector) {
        withdrawReserves(e, account_, amount);
	} else {
        calldataarg args;
        f(e, args);
    }
    return 1;
}

////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////   Michael   /////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// B@B - assetIn of a specific asset is initialized (!0) or uninitialized (0) along with the collateral balance
rule assetIn_Initialized_With_Balance(method f, address user, address asset) 
    filtered { f ->  !similarFunctions(f) && !f.isView && f.selector != absorb(address, address[]).selector && f.selector != certorafallback_0().selector } {
    
    env e; calldataarg args;
    require user != currentContract;
    require getUserCollateralBalanceByAsset(user, asset) > 0 <=> call_Summarized_IsInAsset(getAssetinOfUser(user), asset_to_index(asset));
    call_functions_with_specific_asset(f, e, asset);
    assert getUserCollateralBalanceByAsset(user, asset) > 0 <=> call_Summarized_IsInAsset(getAssetinOfUser(user), asset_to_index(asset));
}

function simplifiedAssumptions() {
    env e;
    require getBaseSupplyIndex(e) == baseIndexScale(e);
    require getBaseBorrowIndex(e) == baseIndexScale(e);
}


// rule sanity(method f) {
// 	env e;
// 	calldataarg arg;
// 	baseBalanceOf(e, arg);
// 	assert false, "this method should have a non reverting path";
// }

// rule withdraw_min(){
//     env e;
//     withdraw(e,e.msg.sender,)
// }



rule balance_change_vs_accrue(method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e;
    calldataarg args;

    require !AccrueWasCalled(e) ;

    uint256 balance_pre = tokenBalanceOf(_baseToken,currentContract);
    f(e,args) ;
    uint256 balance_post = tokenBalanceOf(_baseToken,currentContract);

    assert balance_post != balance_pre => AccrueWasCalled(e);
}


rule balance_change_vs_registered(method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e;
    calldataarg args;
    address token;
    
    bool registered = isRegisterdAsAsset(e,token);
    require token != _baseToken;
    uint256 balance_pre = tokenBalanceOf(token,currentContract);
    f(e,args) ;
    uint256 balance_post = tokenBalanceOf(token,currentContract);

    assert balance_post != balance_pre => registered;
}


 rule usage_registered_assets_only(address asset, method f) filtered { f -> !similarFunctions(f) && !f.isView } { 
//     // check that every function call that has an asset arguments reverts on a non-registered asset 
    env e; calldataarg args;
    simplifiedAssumptions();
    bool registered = isRegisterdAsAsset(e,asset);
    call_functions_with_specific_asset(f, e, asset);
    assert registered; //if the function passed it must be registered 
 }


// moved from CometInterest

// ?@? - Calling to accrue is the only way to change presentValue
rule only_accrue_change_presentValue(method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e; calldataarg args;
  
  call_accrueInternal(e); // maybe change to lastAccrualTime == nowInternal

  int104 principal;
  int104 presentValue1 = call_presentValue(principal);
        f(e,args);
  int104 presentValue2 = call_presentValue(principal);
  
  assert presentValue1 == presentValue2;
}


// ?@? - transfer should not change the combine presentValue of src and dst
rule verify_transferAsset(){
    env e;

    address src;
    address dst;
    address asset;
    uint amount;

    simplifiedAssumptions();

    mathint presentValue_src1 = to_mathint(call_presentValue(getPrincipal(e,src)));
    mathint presentValue_dst1 = to_mathint(call_presentValue(getPrincipal(e,dst)));

    transferAssetFrom(e, src, dst, asset, amount);

    mathint presentValue_src2 = to_mathint(call_presentValue(getPrincipal(e,src)));
    mathint presentValue_dst2 = to_mathint(call_presentValue(getPrincipal(e,dst)));

    assert presentValue_src1 + presentValue_dst1 == presentValue_src2 + presentValue_dst2;
}