import "comet.spec"

methods {
    call_hasPermission(address, address) returns (bool) envfree
}

/*
    @Rule

    @Description:
        User principal balance may decrease only by a call from them or from a permissioned manager

    @Formula:
        {
             userBasic[user].principal = x
        }
        < op >
        {
            userBasic[user].principal = y
            y < x => user = msg.sender || hasPermission[user][msg.sender] == true; 
        }

    @Notes:
        
    @Link:
        https://vaas-stg.certora.com/output/67509/8b70e8c3633a54cfc7ba?anonymousKey=d2c319cb2734c3978e15fa3833f55b19c48f8fda
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
