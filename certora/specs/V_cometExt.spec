methods {
    allowance(address, address) returns (uint256) envfree
    approve(address, uint256 )  returns (bool)
    allow(address, bool)
}

function valid_allowance(uint256 amount) returns bool {
    return (amount == 0 || amount == max_uint256);
}


// V@V - allowance can be only 0 or MAX_INT
invariant allowanceOnlyZeroOrMax(address owner, address spender)
    valid_allowance(allowance(owner, spender))

// V@V - approve fails on invalid amount (not 0 or MAX_INT)
rule approveFailsOnInvalidAllowance(address spender, uint256 amount) {
    env e;
    require !valid_allowance(amount);
    approve@withrevert(e, spender, amount);
    assert lastReverted;
}

// V@V - allowance changes only on allow or approve
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