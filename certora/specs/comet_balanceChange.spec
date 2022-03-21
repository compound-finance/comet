import "comet.spec"

methods {
    call_hasPermission(address, address) returns (bool) envfree
}


// only actions by the user that change their erc20 balance
// are done either by the user or by a permissioned manager
// rule balance_change_by_allowed_only(method f, address user)
// filtered { f-> !similarFunctions(f) && !f.isView }
// {
//     env e;
//     calldataarg args;

//     require user != currentContract;

//     simplifiedAssumptions();

//     uint256 balanceBefore = _baseToken.balanceOf(user);

//     f(e, args);

//     uint256 balanceAfter = _baseToken.balanceOf(user);
//     bool permission = call_hasPermission(user, e.msg.sender);

//     assert balanceAfter < balanceBefore => 
//         ((e.msg.sender == user) || permission);
// }

rule balance_change_by_allowed_only(method f, address user)
filtered { f-> !similarFunctions(f) && !f.isView }
{
    env e;
    calldataarg args;
    require user != currentContract;
    simplifiedAssumptions();

    int104 balanceBefore = getPrincipal(user);

    f(e, args);

    int104 balanceAfter = getPrincipal(user);
    bool permission = call_hasPermission(user, e.msg.sender);

    assert balanceAfter < balanceBefore => 
        ((e.msg.sender == user) || permission);
}

