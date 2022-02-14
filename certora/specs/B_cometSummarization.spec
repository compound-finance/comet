
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

/*
 * summarization for the pause functionality.
 * These summarization are safe since we proved the correctness of getters and update in governance.spec 
 */

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


ghost ghostSignedMulPrice(int, uint, uint) returns int256; 

ghost ghostMulPrice(uint, uint, uint) returns uint256; 