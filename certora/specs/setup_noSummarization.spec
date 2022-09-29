/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is a base file included in other spec files run without summarization or simplifications. 
*/

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   Methods Declarations   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

methods{
    getSupplyRate() returns (uint64)
    getBorrowRate() returns (uint64)
    getUtilization() returns (uint)
    getPrice(address) returns (uint256)
    getReserves() returns (int)
    isBorrowCollateralized(address) returns (bool)
    getBorrowLiquidity(address) returns (int)
    isLiquidatable(address) returns (bool)
    getLiquidationMargin(address) returns (int)
    pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused)
    isSupplyPaused() returns (bool) envfree
    isTransferPaused() returns (bool) envfree
    isWithdrawPaused() returns (bool) envfree
    isAbsorbPaused() returns (bool) envfree
    isBuyPaused() returns (bool) envfree
    baseBalanceOf(address) returns (int256) envfree
    supply(address, uint)
    supplyTo(address, address, uint)
    supplyFrom(address, address, address, uint)
    transferAsset(address, address, uint)
    transferAssetFrom(address, address, address, uint)
    withdraw(address, uint)
    withdrawTo(address, address, uint)
    withdrawFrom(address, address, address, uint)
    absorb(address, address[])
    buyCollateral(address, uint, uint, address)
    quoteCollateral(address, uint) returns (uint)
    withdrawReserves(address, uint)

    // cometHarnessGetters
    getAssetinOfUser(address) returns (uint16) envfree
    getAssetOffsetByAsset(address) returns (uint8) envfree

    // Getters of public vars
    governor() returns (address) envfree
    pauseGuardian() returns (address) envfree
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
