
import "erc20.spec"

using SymbolicBaseToken as _baseToken 

methods {
    _baseToken.balanceOf(address account) returns (uint256) envfree
    call_hasPermission(address, address) returns (bool) envfree
}


function simplifiedAssumptions() {
    env e;
    require getTotalBaseSupplyIndex(e) == baseIndexScale(e);
    require getTotalBaseBorrowIndex(e) == baseIndexScale(e);
}


// B@B - doesn't pass, debugging the rule
rule balance_change_by_allowed_only(method f, address user) {
    env e;
    calldataarg args;

    simplifiedAssumptions();

    uint256 balanceBefore = _baseToken.balanceOf(user);

    f(e, args);

    uint256 balanceAfter = _baseToken.balanceOf(user);
    bool permission = call_hasPermission(user, e.msg.sender);

    assert balanceAfter < balanceBefore => 
        (e.msg.sender == user || permission);
}