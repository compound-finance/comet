/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is a base file included in other spec files run with summarization and simplifications. 
*/

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Methods Declarations   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

methods{

    getUserPrincipal(address) returns (int104) envfree 

    ////////////////////////////////////////////////////////////////////////////////
    //////////////////////////   Pause Summarizations   ////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////
    //
    // These summarization are safe since we proved the correctness of getters and update in pause.spec
    // * notice that when calling these methods from the spec the summarization doesn't apply.
    pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused) => set_paused_summarization(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused)
    isSupplyPaused() returns (bool) envfree => get_supply_paused()
    isTransferPaused() returns (bool) envfree => get_transfer_paused()
    isWithdrawPaused() returns (bool) envfree => get_withdraw_paused()
    isAbsorbPaused() returns (bool) envfree => get_absorb_paused()
    isBuyPaused() returns (bool) envfree => get_buy_paused()
    getPauseFlags() returns (uint8) envfree

    ////////////////////////////////////////////////////////////////////////////////
    //////////////////////////   Identity Summarization   //////////////////////////
    ////////////////////////////////////////////////////////////////////////////////
    //
    // All summarized functions return their input value in order to simplify the computational complexity
    // These summarization are under approximations, they are assuming that BaseSupplyIndex and BaseBorrowIndex are at the base index scale   

    getPrincipal(int104 x) returns (int104) envfree => identityInt(x);
    presentValueSupply(uint64 index, uint104 x) returns (uint104) envfree => identity(x); 
    presentValueBorrow(uint64 index, uint104 x) returns (uint104) envfree => identity(x); 
    principalValue(int104 x) returns (int104) envfree => identityInt(x);
    principalValueSupply(uint64 index, uint104 x) returns (uint104) envfree => identity(x); 
    principalValueBorrow(uint64 index, uint104 x) returns (uint104) envfree => identity(x); 

    // Another simplification assuming the price is always 1 
    getPrice(address priceFeed) returns (uint128) => ALWAYS(1)

}

////////////////////////////////////////////////////////////////////////////////
///////////////////////////////   Definitions   ////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

    // A set of functions that are similar to other functions in the original contract and can be omitted during verifications due to this similarity.
    // e.g. there are 3 withdraw functions in comet - withdraw, withdrawTo and withdrawFrom.
    // All of these functinos are calling the internal function withdrawInternal with some input args from the user and some predefined args.
    // WithdrawFrom is the most general out of the 3, in such way that by passing specific value to withdrawFrom, one can simulate a call to the other 2 withdraw functions,
    // Therefore it's enough to check correctness of withdrawFrom, given that we allow arbitrary input values when calling the function
    definition similarFunctions(method f) returns bool =    
                f.selector == withdraw(address,uint256).selector ||
                f.selector == withdrawTo(address,address,uint).selector ||
                f.selector == transferAsset(address,address,uint).selector ||
                f.selector == transfer(address, uint).selector ||
                f.selector == transferFrom(address, address, uint).selector ||
                f.selector == supplyTo(address,address,uint).selector ||
                f.selector == supply(address,uint).selector ||
                f.selector == initializeStorage().selector ;

    ////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////   pauseGuardian   //////////////////////////////
    ////////////////////////////////////////////////////////////////////////////////
    //
    // Functions and definitions for pause guardian integrity
    //

    // A definition of all supply functions in the contract
    definition all_public_supply_methods(method f) returns bool =
        f.selector == supply(address, uint).selector || 
        f.selector == supplyTo(address, address, uint).selector || 
        f.selector == supplyFrom(address, address, address, uint).selector;

    // A definition of all supply functions in the contract
    definition all_public_transfer_methods(method f) returns bool =
        f.selector == transferAsset(address, address, uint).selector || 
        f.selector == transferAssetFrom(address, address, address, uint).selector;

    // A definition of all withdraw functions in the contract
    definition all_public_withdraw_methods(method f) returns bool =
        f.selector == withdraw(address, uint).selector || 
        f.selector == withdrawTo(address, address, uint).selector || 
        f.selector == withdrawFrom(address, address, address, uint).selector;

    // A definition of all absorb functions in the contract
    definition all_public_absorb_methods(method f) returns bool =
        f.selector == absorb(address, address[]).selector;

    // A definition of all buy functions in the contract
    definition all_public_buy_methods(method f) returns bool =
        f.selector == buyCollateral(address, uint, uint, address).selector;


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////   Functions   /////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

    // Identity function - returns the input value. Used to summarize computationally complex methods
    function identityInt(int104 x) returns int104 {
        return x;
    }

    // Identity function - returns the input value. Used to summarize computationally complex methods
    function identity(uint104 x) returns uint104 {
        return x;
    }

    ////////////////////////////////////////////////////////////////////////////////
    ////////////////////////   pause getters and update   //////////////////////////
    ////////////////////////////////////////////////////////////////////////////////
    //
    // Summarization for the pause functionality.
    // These summarization are safe since we proved the correctness of getters and update in pause.spec, pauseGuardians.spec
    //

    // Pasue ghosts
    ghost bool supply_paused_ghost; // ghost variable tracking supplyPaused value
    ghost bool transfer_paused_ghost; // ghost variable tracking transferPaused value
    ghost bool withdraw_paused_ghost; // ghost variable tracking withdrawPaused value
    ghost bool absorb_paused_ghost; // ghost variable tracking absorbPaused value
    ghost bool buy_paused_ghost; // ghost variable tracking buyPaused value


    // A spec setter to replace the pause() method in the contract
    function set_paused_summarization(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused) returns bool{
        supply_paused_ghost = supplyPaused;
        transfer_paused_ghost = transferPaused;
        withdraw_paused_ghost = withdrawPaused;
        absorb_paused_ghost = absorbPaused;
        buy_paused_ghost = buyPaused;
        
        return true;
    }

    // A spec getter to replace isSupplyPaused() method in the contract
    function get_supply_paused() returns bool{
        return supply_paused_ghost;
    }

    // A spec getter to replace get_transfer_paused() method in the contract
    function get_transfer_paused() returns bool{
        return transfer_paused_ghost;
    }

    // A spec getter to replace get_withdraw_paused() method in the contract
    function get_withdraw_paused() returns bool{
        return withdraw_paused_ghost;
    }

    // A spec getter to replace get_absorb_paused() method in the contract
    function get_absorb_paused() returns bool{
        return absorb_paused_ghost;
    }

    // A spec getter to replace get_buy_paused() method in the contract
    function get_buy_paused() returns bool{
        return buy_paused_ghost;
    }
