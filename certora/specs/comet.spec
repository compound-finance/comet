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
}


ghost sumUserBasicPrinciple() returns mathint {
	init_state axiom sumUserBasicPrinciple()==0; // for the constructor
	// axiom sumAllFunds() == 0; bad example use this for 
}


hook Sstore userBasic[KEY address a].principal int104 balance
    (int104 old_balance) STORAGE {
  havoc sumUserBasicPrinciple assuming sumUserBasicPrinciple@new() == sumUserBasicPrinciple@old() +
      balance - old_balance;
}

rule whoChangedMyGhost(method f) {
	mathint before = sumUserBasicPrinciple();
	env e;
	calldataarg args;
	f(e,args);
	mathint after = sumUserBasicPrinciple();
	assert( before == after);
}


invariant totalBaseToken() 
	sumUserBasicPrinciple() == getTotalSupplyBase()
{
    preserved {
         env e;
        require getTotalBaseSupplyIndex(e) == baseIndexScale(e);
        require getTotalBaseBorrowIndex(e) == baseIndexScale(e);
    }
}


function simplifiedAssumptions() {
    env e;
    require getTotalBaseSupplyIndex(e) == baseIndexScale(e);
    require getTotalBaseBorrowIndex(e) == baseIndexScale(e);
}

rule withraw_all_balance(){
    env e;
    uint balance = baseToken.balanceOf(currentContract);
    withdraw(e.msg.sender,balance);
    assert false;
}