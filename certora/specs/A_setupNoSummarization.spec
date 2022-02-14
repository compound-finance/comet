methods{
    // getAssetInfo(uint8) returns (AssetInfo)
    getNow() returns (uint40)
    accrue()
    allow(address, bool)
    allowBySig(address, address, bool, uint256, uint256, uint8, bytes32, bytes32)
    hasPermission(address, address) returns (bool)
    getSupplyRate() returns (uint64)
    getBorrowRate() returns (uint64)
    getUtilization() returns (uint)
    getPrice(address) returns (uint)
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
    baseBalanceOf(address)
    collateralBalanceOf(address, address)
    supply(address, uint)
    supplyTo(address, address, uint)
    supplyFrom(address, address, address, uint)
    transfer(address, address, uint)
    transferFrom(address, address, address, uint)
    transferCollateral(address, address, address, uint128)
    withdraw(address, uint)
    withdrawTo(address, address, uint)
    withdrawFrom(address, address, address, uint)
    absorb(address, address[])
    buyCollateral(address, uint, uint, address)
    quoteCollateral(address, uint) returns (uint)
    withdrawReserves(address, uint)

    // self generated getters
    governor() envfree
    pauseGuardian() envfree
}

// assumes some non-zero values on the environment
function envNotZero(env e){
    require e.block.timestamp != 0;
    require e.block.number != 0;
    require e.msg.sender != 0;
}

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