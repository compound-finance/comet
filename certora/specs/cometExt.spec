// Rules for CometExt.sol

methods {
    allowance(address, address) returns (uint256) envfree
    approve(address, uint256 )  returns (bool)
    allow(address, bool)
}

function valid_allowance(uint256 amount) returns bool {
    return (amount == 0 || amount == max_uint256);
}


// V@V - allowance may be equal only to 0 or max_uint
invariant allowanceOnlyZeroOrMax(address owner, address spender)
    valid_allowance(allowance(owner, spender))


// V@V - approve fails on invalid amount (different from 0 or max_uint)
rule approveFailsOnInvalidAllowance(address spender, uint256 amount) {
    env e;
    approve@withrevert(e, spender, amount);
    assert lastReverted;
}

// V@V -  allowance changes only on allow or approve
// also tests that if allowance changed for an address different from msg.sender,
// it happened as a result of allowBySig
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


// V@V approve must work when the amount is valid and value is sent to the function
rule validApproveSucceeds(address spender, uint256 amount) {
    env e;
    require valid_allowance(amount);
    // the rule fails with any value > 0
    require e.msg.value == 0;

    approve@withrevert(e, spender, amount);

    assert !lastReverted;
}
