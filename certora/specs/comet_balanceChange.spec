import "comet.spec"

methods {
    call_hasPermission(address, address) returns (bool) envfree
}

/* 
 Description :  
        User principal balance may decrease only by a call from them or from a permissioned manager

 formula : 
        userBasic[user].principal == x;
        op;
        userBasic[user].principal == y;
        y < x => msg.sender == user || hasPermission[user][msg.sender] == true; 

 status : proved     
*/
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

