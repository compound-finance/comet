/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyGovernance.sh

    This file contains rules related to operations allowed by the governor
*/

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Methods Declarations   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

methods {
    governor() returns (address) envfree
    pauseGuardian() returns (address) envfree
}

////////////////////////////////////////////////////////////////////////////////
///////////////////////////////   Definitions   ////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// The set of all functions that require special permissions
definition governedFunctions(method f) returns bool =    
    f.selector == pause(bool, bool, bool, bool, bool).selector ||
    f.selector == withdrawReserves(address, uint).selector;

// A definition of an address that has special permission(s) - either a governor or a pause guardian
definition governorOrPauseGuardian(address a) returns bool =
    a == governor() || a == pauseGuardian();

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/387161f7114e2ff5b812/?anonymousKey=d17333a55e7b84259e0098045fc65b4e9e56c546

/*
    @Rule

    @Description:
        pause() and withdrawReserves() may be called only by governor or by pauseGuardian (pause)

    @Formula:
        { 

        }
        
        < call to pause() or withdrawReserves() >
        
        { 
            !lastReverted => msg.sender = governor || msg.sender = pauseGuardian
        }

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
