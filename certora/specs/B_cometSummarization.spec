
methods{
    /*
     * These summarization are safe since we proved the correctness of getters and update in pause.spec
     */
    // notice that calling these methods the summarization doesn't apply.
    pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused) => set_Paused_Summarization(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused)
    isSupplyPaused() returns (bool) envfree => get_Supply_Paused()
    isTransferPaused() returns (bool) envfree => get_Transfer_Paused()
    isWithdrawPaused() returns (bool) envfree => get_Withdraw_Paused()
    isAbsorbPaused() returns (bool) envfree => get_Absorb_Paused()
    isBuyPaused() returns (bool) envfree => get_Buy_Paused()
    getPauseFlags() returns (uint8) envfree
    signedMulPrice(int amount, uint price, uint tokenScale) => ghostSignedMulPrice(amount,price,tokenScale);
    mulPrice(uint amount, uint price, uint tokenScale) => ghostMulPrice(amount,price,tokenScale);
}

ghost ghostSignedMulPrice(int, uint, uint) returns int256; 

ghost ghostMulPrice(uint, uint, uint) returns uint256; 


////////////////////////////////////////////////////////////////////////////////
////////////////////////   pause getters and update   //////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
// summarization for the pause functionality.
// These summarization are safe since we proved the correctness of getters and update in governance.spec 
//

// pasue ghosts
ghost bool supply_Paused_Ghost; // ghost variable tracking supplyPaused value
ghost bool transfer_Paused_Ghost; // ghost variable tracking transferPaused value
ghost bool withdraw_Paused_Ghost; // ghost variable tracking withdrawPaused value
ghost bool absorb_Paused_Ghost; // ghost variable tracking absorbPaused value
ghost bool buy_Paused_Ghost; // ghost variable tracking buyPaused value


// A spec setter to replace the pause() method in the contract
function set_Paused_Summarization(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused) returns bool{
    supply_Paused_Ghost = supplyPaused;
    transfer_Paused_Ghost = transferPaused;
    withdraw_Paused_Ghost = withdrawPaused;
    absorb_Paused_Ghost = absorbPaused;
    buy_Paused_Ghost = buyPaused;
    
    return true;
}

// a spec getter to replace isSupplyPaused() method in the contract
function get_Supply_Paused() returns bool{
    return supply_Paused_Ghost;
}

// a spec getter to replace get_Transfer_Paused() method in the contract
function get_Transfer_Paused() returns bool{
    return transfer_Paused_Ghost;
}

// a spec getter to replace get_Withdraw_Paused() method in the contract
function get_Withdraw_Paused() returns bool{
    return withdraw_Paused_Ghost;
}

// a spec getter to replace get_Absorb_Paused() method in the contract
function get_Absorb_Paused() returns bool{
    return absorb_Paused_Ghost;
}

// a spec getter to replace get_Buy_Paused() method in the contract
function get_Buy_Paused() returns bool{
    return buy_Paused_Ghost;
}


////////////////////////////////////////////////////////////////////////////////
///////////////////////////////   pauseGuardian   //////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
// functions and definitions for pause guardian integrity
//

// a definition of all supply functions in the contract
definition all_public_supply_methods(method f) returns bool =
    f.selector == supply(address, uint).selector || 
    f.selector == supplyTo(address, address, uint).selector || 
    f.selector == supplyFrom(address, address, address, uint).selector;

// calling all different supply functions with revert
// @note if you want to use this without revert just call the function with require on the output to be false
function supply_functions_with_revert(method f, env e) returns bool{
    calldataarg args;
    bool reverted;
    
    if (f.selector == supply(address, uint).selector) {
        supply@withrevert(e, args);
        reverted = lastReverted;
    } else if (f.selector == supplyTo(address, address, uint).selector) {
        supplyTo@withrevert(e, args);
        reverted = lastReverted;
    } else if (f.selector == supplyFrom(address, address, address, uint).selector) {
        supplyFrom@withrevert(e, args);
        reverted = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted = lastReverted;
    }
    return reverted;
}

// a definition of all supply functions in the contract
definition all_public_transfer_methods(method f) returns bool =
    f.selector == transfer(address, address, uint).selector || 
    f.selector == transferFrom(address, address, address, uint).selector;


// calling all different transfer functions with revert
// @note if you want to use this without revert just call the function with require on the output to be false
function transfer_functions_with_revert(method f, env e) returns bool{
    calldataarg args;
    bool reverted;
    
    if (f.selector == transfer(address, address, uint).selector) {
        transfer@withrevert(e, args);
        reverted = lastReverted;
    } else if (f.selector == transferFrom(address, address, address, uint).selector) {
        transferFrom@withrevert(e, args);
        reverted = lastReverted;
    } else{
        // assert false, "this is an assert false";
        f@withrevert(e, args);
        reverted = lastReverted;
    }
    return reverted;
}

// a definition of all withdraw functions in the contract
definition all_public_withdraw_methods(method f) returns bool =
    f.selector == withdraw(address, uint).selector || 
    f.selector == withdrawTo(address, address, uint).selector || 
    f.selector == withdrawFrom(address, address, address, uint).selector;


// calling all different withdraw functions with revert
// @note if you want to use this without revert just call the function with require on the output to be false
function withdraw_functions_with_revert(method f, env e) returns bool{
    calldataarg args;
    bool reverted;
    
    if (f.selector == withdraw(address, uint).selector) {
        withdraw@withrevert(e, args);
        reverted = lastReverted;
    } else if (f.selector == withdrawTo(address, address, uint).selector) {
        withdrawTo@withrevert(e, args);
        reverted = lastReverted;
    } else if (f.selector == withdrawFrom(address, address, address, uint).selector) {
        withdrawFrom@withrevert(e, args);
        reverted = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted = lastReverted;
    }
    return reverted;
}

// a definition of all absorb functions in the contract
definition all_public_absorb_methods(method f) returns bool =
    f.selector == absorb(address, address[]).selector;


// calling all different absorb functions with revert
// @note if you want to use this without revert just call the function with require on the output to be false
function absorb_functions_with_revert(method f, env e) returns bool{
    calldataarg args;
    bool reverted;
    
    if (f.selector == absorb(address, address[]).selector) {
        absorb@withrevert(e, args);
        reverted = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted = lastReverted;
    }
    return reverted;
}

// a definition of all buy functions in the contract
definition all_public_buy_methods(method f) returns bool =
    f.selector == buyCollateral(address, uint, uint, address).selector;


// calling all different buy functions with revert
// @note if you want to use this without revert just call the function with require on the output to be false
function buy_functions_with_revert(method f, env e) returns bool{
    calldataarg args;
    bool reverted;
    
    if (f.selector == buyCollateral(address, uint, uint, address).selector) {
        buyCollateral@withrevert(e, args);
        reverted = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted = lastReverted;
    }
    return reverted;
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////   userCollaterAsset   /////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
// functions and definitions for pause guardian integrity
//

ghost isInAsset(address, address) returns bool
