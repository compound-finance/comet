methods {
    pause(bool ,bool ,bool ,bool ,bool)
    withdrawReserves(address , uint) 
    governor() returns (address) envfree
    pauseGuardian() returns (address) envfree
}

definition governedFunctions(method f) returns bool =    
    f.selector == pause(bool, bool, bool, bool, bool).selector ||
    f.selector == withdrawReserves(address, uint).selector;

definition governorOrPauseGuardian(address a) returns bool =
    a == governor() || a == pauseGuardian();


// verify that pause and withdrawReserves don't revert only when msg.sender is governor
rule governorIntegrity(method f) filtered { f -> governedFunctions(f)  }
{
    env e;
    calldataarg args;

    address governor = governor();
    address pauseGuardian = pauseGuardian();
    invoke f(e, args);

    assert  !lastReverted => 
        f.selector == pause(bool, bool, bool, bool, bool).selector && governorOrPauseGuardian(e.msg.sender) ||
        f.selector == withdrawReserves(address, uint).selector && e.msg.sender == governor;
}