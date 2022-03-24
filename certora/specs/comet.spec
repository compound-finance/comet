import "B_cometSummarization.spec"
import "erc20.spec"


using SymbolicBaseToken as _baseToken 


methods {
    latestRoundData() returns uint256 => DISPATCHER(true);

    isBorrowCollateralized(address) returns bool 
    
    baseToken() returns address envfree
    getTotalSupplyBase() returns (uint104) envfree
    getTotalBorrowBase() returns (uint104) envfree 
    getTotalsSupplyAsset(address asset) returns (uint128) envfree  
    getAssetSupplyCapByAddress(address) returns (uint128) envfree
    getReserves() returns (int) envfree
    targetReserves() returns (uint256) envfree
    initializeStorage() 

    _baseToken.balanceOf(address account) returns (uint256) envfree

    callSummarizedIsInAsset(uint16, uint8) returns (bool) envfree
    call_hasPermission(address, address) returns (bool) envfree
    getAssetinOfUser(address) returns (uint16) envfree
    assetToIndex(address) returns (uint8) envfree
    indexToAsset(uint8) returns (address) envfree
    tokenBalanceOf(address, address) returns uint256 envfree 
}

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Simplifications   /////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// A set of simplifications (under approximations) that are being applied due to the complexity fo the code
function simplifiedAssumptions() {
    env e;
    require getBaseSupplyIndex(e) == getBaseIndexScale(e);
    require getBaseBorrowIndex(e) == getBaseIndexScale(e);
}

// Simplification - assume scale is always 1 
hook Sload uint64 scale assetInfoMap[KEY uint8 assetOffset].scale STORAGE {
        require scale == 1;
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////   Ghost    ////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// Summarization of the user principle - the ghost tracks the sum of principles across all users
ghost mathint sumUserBasicPrinciple  {
	init_state axiom sumUserBasicPrinciple==0; 
}

// Summarization of the user collateral per asset - mapping ghost that keeps track on the sum of balances of each collateral asset
ghost mapping(address => mathint) sumBalancePerAsset {
    init_state axiom forall address t. sumBalancePerAsset[t]==0;
}

// A hook updating the user principle ghost on every write to storage
hook Sstore userBasic[KEY address a].principal int104 balance
    (int104 old_balance) STORAGE {
  sumUserBasicPrinciple = sumUserBasicPrinciple +
      to_mathint(balance) - to_mathint(old_balance);
}

// A hook updating an asset's total balance on every write to storage
hook Sstore userCollateral[KEY address account][KEY address t].balance  uint128 balance (uint128 old_balance) STORAGE {
    sumBalancePerAsset[t] = sumBalancePerAsset[t] - old_balance + balance;
}


// General function that calls each method on a specific asset 
function call_functions_with_specific_asset(method f, env e, address asset) returns uint{
    address _account; uint amount; address account_; uint minAmount;
    address[] accounts_array;
	if (f.selector == supply(address, uint).selector) {
        supply(e, asset, amount);
	} else if (f.selector == supplyTo(address, address, uint).selector) {
        supplyTo(e, account_, asset, amount);
	} else if  (f.selector == supplyFrom(address, address, address, uint).selector) {
        supplyFrom(e, _account, account_, asset, amount);
	} else if (f.selector == transferAsset(address, address, uint).selector) {
        transferAsset(e, account_, asset, amount);
	} else if (f.selector == transferAssetFrom(address, address, address, uint).selector) {
        transferAssetFrom(e, _account, account_, asset, amount);
	} else if (f.selector == transferAssetFromBase(address, address, address, uint).selector) {
        transferAssetFromBase(e, _account, account_, asset, amount);
	} else if (f.selector == transferAssetFromAsset(address, address, address, uint).selector) {
        transferAssetFromAsset(e, _account, account_, asset, amount);
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


/*
    @Rule

    @Description:
        The assetIn switch of a specific asset is either initialized (!0) or uninitialized (0) along with the collateral balance

    @Formula:
        {
            userCollateral[user][asset].balance > 0 <=> isInAsset(userBasic[user].assetsIn, asset.offset)
        }

        < call any function with a specific asset >
        
        {
            userCollateral[user][asset].balance > 0 <=> isInAsset(userBasic[user].assetsIn, asset.offset)
        }

    @Note:
        This property was proved on summarized version of the function isInAsset().

    @Link:
*/

rule assetIn_Initialized_With_Balance(method f, address user, address asset) 
    filtered { f ->  !similarFunctions(f) && !f.isView && f.selector != absorb(address, address[]).selector && f.selector != certorafallback_0().selector } {
    
    env e; calldataarg args;
    require user != currentContract;
    require getUserCollateralBalance(e,user, asset) > 0 <=> callSummarizedIsInAsset(getAssetinOfUser(user), assetToIndex(asset));
    call_functions_with_specific_asset(f, e, asset);
    assert getUserCollateralBalance(e,user, asset) > 0 <=> callSummarizedIsInAsset(getAssetinOfUser(user), assetToIndex(asset));
}


/*
    @Rule:

    @Description:
        can't change balance without calling accrue

    @Formula:
        {
            balance_pre = tokenBalanceOf(_baseToken,currentContract)
        }

        < call any function >

        {
            balance_pre != tokenBalanceOf(_baseToken,currentContract) => accrueWasCalled()
        }

    @Notes:

    @Link:

*/

rule balance_change_vs_accrue(method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e;
    calldataarg args;

    require !accrueWasCalled(e) ;

    uint256 balance_pre = tokenBalanceOf(_baseToken,currentContract);
    f(e,args) ;
    uint256 balance_post = tokenBalanceOf(_baseToken,currentContract);

    assert balance_post != balance_pre => accrueWasCalled(e);
}

/*
    @Rule:

    @Description:


    @Formula:
        {

        }

        

        {
            
        }

    @Notes:

    @Link:

*/

rule balance_change_vs_registered(method f)filtered { f-> !similarFunctions(f) && !f.isView }{
    env e; calldataarg args;
    address token;
    
    bool registered = isRegisterdAsAsset(e,token);
    require token != _baseToken;
    uint256 balance_pre = tokenBalanceOf(token,currentContract);
    f(e,args) ;
    uint256 balance_post = tokenBalanceOf(token,currentContract);

    assert balance_post != balance_pre => registered;
}

/*
    @Rule:

    @Description:


    @Formula:
        {

        }

        

        {
            
        }

    @Notes:

    @Link:

*/

rule usage_registered_assets_only(address asset, method f) filtered { f -> !similarFunctions(f) && !f.isView } { 
    // check that every function call that has an asset arguments reverts on a non-registered asset 
    env e; calldataarg args;
    simplifiedAssumptions();
    bool registered = isRegisterdAsAsset(e,asset);
    call_functions_with_specific_asset(f, e, asset);
    assert registered; //if the function passed it must be registered 
 }