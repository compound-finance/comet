import "B_cometSummarization.spec"
methods {
    //temporary under approxiamtions
    isInAsset(uint16 assetsIn, uint8 assetOffset) => CONSTANT;
    latestRoundData() returns uint256 => CONSTANT;

    //todo - move to setup?
    isBorrowCollateralized(address) returns bool envfree
    getUserCollateralBalance(address,address) returns uint128 envfree

    baseToken() returns address envfree
    getTotalSupplyBase() returns (uint104) envfree
    getTotalBorrowBase() returns (uint104) envfree 
    getTotalsSupplyAsset(address asset) returns (uint128) envfree  
}


ghost mathint sumUserBasicPrinciple  {
	init_state axiom sumUserBasicPrinciple==0; 
}

ghost mapping( address => mathint) sumBalancePerAssert; 


hook Sstore userBasic[KEY address a].principal int104 balance
    (int104 old_balance) STORAGE {
  sumUserBasicPrinciple  = sumUserBasicPrinciple +
      to_mathint(balance) - to_mathint(old_balance);
}

hook Sstore userCollateral[KEY address account][KEY address t].balance  uint128 balance (uint128 old_balance) STORAGE {
    sumBalancePerAssert[t] = sumBalancePerAssert[t] - old_balance + balance;
}

rule whoChangedMyGhost(method f) {
	mathint before = sumUserBasicPrinciple;
	env e;
	calldataarg args;
	f(e,args);
	mathint after = sumUserBasicPrinciple;
	assert( before == after);
}


rule whoChangedSumBalancePerAssert(method f, address t) {
	mathint before = sumBalancePerAssert[t];
	env e;
	calldataarg args;
	f(e,args);
	mathint after = sumBalancePerAssert[t];
	assert( before == after);
}

invariant totalBaseToken() 
	sumUserBasicPrinciple == getTotalSupplyBase()
{
    preserved {
        simplifiedAssumptions();
    }
}

invariant totalCollateralPerAsset(address asset) 
    sumBalancePerAssert[asset] == getTotalsSupplyAsset(asset)     
    {
        preserved {
            simplifiedAssumptions();
        }
    }

function simplifiedAssumptions() {
    env e;
    require getTotalBaseSupplyIndex(e) == baseIndexScale(e);
    require getTotalBaseBorrowIndex(e) == baseIndexScale(e);
}

rule withdraw_all_balance(){
    env e;
    uint balance = baseToken.balanceOf(currentContract);
    withdraw(e.msg.sender,balance);
    assert false;
}