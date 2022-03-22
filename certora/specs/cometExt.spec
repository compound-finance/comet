// Rules for CometExt.sol

methods {
    allowance(address, address) returns (uint256) envfree
    approve(address, uint256 )  returns (bool)
    allow(address, bool)
}

function valid_allowance(uint256 amount) returns bool {
    return (amount == 0 || amount == max_uint256);
}


/* 
 Description :  
        Spender's allowance may only be equal to 0 or to max_uint256

 formula : 
        allowance[owner][spender] == 0 || allowance[owner][spender] == max_uint256

 status : proved       
*/
invariant allowanceOnlyZeroOrMax(address owner, address spender)
    valid_allowance(allowance(owner, spender))


/* 
 Description :  
        Trying to approve an allowance which is not 0 or max_uint should fail

 formula : 
        amount > 0 && amount < max_uint256 => approve(spender, amount) reverts

 status : proved     
*/
rule approveFailsOnInvalidAllowance(address spender, uint256 amount) {
    env e;
    require amount > 0 && amount < max_uint256;
    approve@withrevert(e, spender, amount);
    assert lastReverted;
}

/* 
 Description :  
        Allowance changes only as a result of approve(), allow() and allowBySig().
        Allowance changes for non msg.sender only as a result of allowBySig()

 formula : 
        allowance[owner][spender] = x;
        op;
        allowance[owner][spender] = y;
        x != y => op in {approve(), allow(), allowBySig()}

 status : proved     
*/
rule validAllowanceChanges(method f, address owner, address spender) {
    env e; calldataarg args;
    uint256 allowanceBefore = allowance(owner, spender);
    f(e, args);
    uint256 allowanceAfter = allowance(owner, spender);
    
    assert allowanceAfter != allowanceBefore => 
        f.selector == approve(address, uint256).selector || 
        f.selector == allow(address, bool).selector ||
        f.selector == allowBySig(address, address, bool, uint256, uint256, uint8, bytes32, bytes32).selector;
    
    // only allowBySig may change allowance for another address (which is not msg.sender)
    assert allowanceAfter != allowanceBefore && owner != e.msg.sender => 
        f.selector == allowBySig(address, address, bool, uint256, uint256, uint8, bytes32, bytes32).selector;
}


/* 
 Description :  
        Trying to approve an allowance which is 0 or max_uint should always succeed

 formula : 
        amount == 0 && amount == max_uint256 => approve(spender, amount) doesn't revert

 status : proved     
*/
rule validApproveSucceeds(address spender, uint256 amount) {
    env e;
    require valid_allowance(amount);
    // the rule fails with any value > 0
    require e.msg.value == 0;

    approve@withrevert(e, spender, amount);

    assert !lastReverted;
}
