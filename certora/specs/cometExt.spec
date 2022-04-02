/*
    This is a specification file for the verification of CometExt.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyCometExt.sh

    This file contains rules related to allowance and approvals.
*/

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Methods Declarations   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

methods {
    allowance(address, address) returns (uint256) envfree
    approve(address, uint256 )  returns (bool)
    allow(address, bool)
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////   Functions   /////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// A function that retrieves true only if the amount is 0 or max_uint256
function valid_allowance(uint256 amount) returns bool {
    return (amount == 0 || amount == max_uint256);
}

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/2b35f19f0d084f7904da/?anonymousKey=1a6da243372e7ea8f91e64b8b98cb7ca5959eb7a

/*
    @Rule

    @Description:
        Spender's allowance may only be equal to 0 or to max_uint256

    @Formula:
        allowance[owner][spender] == 0 || allowance[owner][spender] == max_uint256

    @Notes:

    @Link:
        https://vaas-stg.certora.com/output/67509/a24bef867b4182d0ff68?anonymousKey=4a4d2ee36793cf0700bd496f045f0ad3c64e5191
*/

invariant allowance_only_zero_or_max(address owner, address spender)
    valid_allowance(allowance(owner, spender))

/*
    @Rule

    @Description:
        Trying to approve an allowance which is not 0 or max_uint should fail

    @Formula:
        { 
            0 < amount < max_uint256
        }
        
        < approve(spender, amount) >

        {
            lastReverted 
        }

    @Notes:

    @Link:
        https://vaas-stg.certora.com/output/67509/c3d2d3cf8c215d055b2e/?anonymousKey=253def519e372bae51eecc09b459fb60849b850e
*/

rule approve_fails_on_invalid_allowance(address spender, uint256 amount) {
    env e;
    require amount > 0 && amount < max_uint256;
    approve@withrevert(e, spender, amount);
    assert lastReverted;
}

/*
    @Rule

    @Description:
        Allowance changes only as a result of approve(), allow() and allowBySig().
        Allowance changes for non msg.sender only as a result of allowBySig()

    @Formula:
        { 
            allowanceBefore = allowance[owner][spender] 
        }

        < call any function >
        
        { 
            allowanceAfter = allowance[owner][spender] &&
            allowanceBefore != allowanceAfter => f.selector == approve || f.selector == allow || f.selector == allowBySig
        }

    @Notes:

    @Link:
        https://vaas-stg.certora.com/output/67509/9620fa8dc4cfe4a67cdd?anonymousKey=42c7e941001d7ca062ee1d4ee7cfd3304b52f2fc
*/

rule valid_allowance_changes(method f, address owner, address spender) {
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
    @Rule

    @Description:
        Approve with a valid amount (0 or max_uint256) succeeds

    @Formula:
        { 
            amount = 0 || 
            amount = max_uint256
        }
        
        < approve(spender, amount) >
        
        {
            !lastReverted
        }

    @Notes:

    @Link:
        https://vaas-stg.certora.com/output/67509/9a48f15e2358f6600c36?anonymousKey=194acb8989d08cbd7b5cec1e8045fb319bd5138d
*/

rule valid_approve_succeeds(address spender, uint256 amount) {
    env e;
    require valid_allowance(amount);
    // the rule fails with any value > 0
    require e.msg.value == 0;

    approve@withrevert(e, spender, amount);

    assert !lastReverted;
}
