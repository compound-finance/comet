methods {
    governor() returns (address) envfree
    pauseGuardian() returns (address) envfree
}

definition governedFunctions(method f) returns bool =    
    f.selector == pause(bool, bool, bool, bool, bool).selector ||
    f.selector == withdrawReserves(address, uint).selector;

definition governorOrPauseGuardian(address a) returns bool =
    a == governor() || a == pauseGuardian();


/*
    @Rule

    @Description:
        pause() and withdrawReserves() may be called only by governor or by pauseGuardian (pause)

    @Formula:
        { }
        < call to function pause() or withdrawReserves() >
        { !lastReverted => user(msg.sender) = governor || user(msg.sender) = pauseGuardian}

    @Notes:

    @Link:
        https://vaas-stg.certora.com/output/67509/440f56e30a982ae399d3/?anonymousKey=125470c4b4a2982c43ea946109e021b940c49b6b
*/
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