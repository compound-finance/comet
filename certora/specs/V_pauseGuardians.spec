import "B_cometSummarization.spec"

////////////////////////////////////////////////////////////////////////////////
//////////////////////////   pauseGuard Integrity   ////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// V@V - checks supply functions are reverting if pauseSupply is true
rule check_pauseSupply_functionality(method f, env e) filtered {f -> all_public_supply_methods(f)} {
    bool flagSupply = get_Supply_Paused(); // summarization

    calldataarg args;
    bool reverted_supply;
    if (f.selector == supply(address, uint).selector) {
        supply@withrevert(e, args);
        reverted_supply = lastReverted;
    } else if (f.selector == supplyTo(address, address, uint).selector) {
        supplyTo@withrevert(e, args);
        reverted_supply = lastReverted;
    } else if (f.selector == supplyFrom(address, address, address, uint).selector) {
        supplyFrom@withrevert(e, args);
        reverted_supply = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted_supply = lastReverted;
    }

    // bool reverted_supply = supply_functions_with_revert(f, e);
    assert flagSupply => reverted_supply;
}

// V@V - checks transfer functions are reverting if pauseTransfer is true
rule check_pauseTransfer_functionality(method f, env e) filtered {f -> all_public_transfer_methods(f)} {
    bool flagTransfer = get_Transfer_Paused(); // summarization
    
    calldataarg args;
    bool reverted_transfer;
    if (f.selector == transfer(address, address, uint).selector) {
        transfer@withrevert(e, args);
        reverted_transfer = lastReverted;
    } else if (f.selector == transferFrom(address, address, address, uint).selector) {
        transferFrom@withrevert(e, args);
        reverted_transfer = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted_transfer = lastReverted;
    }
    
    // bool reverted_transfer = transfer_functions_with_revert(f, e);
    assert flagTransfer => reverted_transfer;
}

// V@V - checks withdraw functions are reverting if pauseWithdraw is true
rule check_pauseWithdraw_functionality(method f, env e) filtered {f -> all_public_withdraw_methods(f)} {
    bool flagWithdraw = get_Withdraw_Paused(); // summarization

    calldataarg args;
    bool reverted_withdraw;
    
    if (f.selector == withdraw(address, uint).selector) {
        withdraw@withrevert(e, args);
        reverted_withdraw = lastReverted;
    } else if (f.selector == withdrawTo(address, address, uint).selector) {
        withdrawTo@withrevert(e, args);
        reverted_withdraw = lastReverted;
    } else if (f.selector == withdrawFrom(address, address, address, uint).selector) {
        withdrawFrom@withrevert(e, args);
        reverted_withdraw = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted_withdraw = lastReverted;
    }

    // bool reverted_withdraw = withdraw_functions_with_revert(f, e);
    assert flagWithdraw => reverted_withdraw;
}

// V@V - checks absorb functions are reverting if pauseAbsorb is true
rule check_pauseAbsorb_functionality(method f, env e) filtered {f -> all_public_absorb_methods(f)} {
    bool flagAbsorb = get_Absorb_Paused(); // summarization

    calldataarg args;
    bool reverted_absorb;
    
    if (f.selector == absorb(address, address[]).selector) {
        absorb@withrevert(e, args);
        reverted_absorb = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted_absorb = lastReverted;
    }

    // bool reverted_absorb = absorb_functions_with_revert(f, e);
    assert flagAbsorb => reverted_absorb;
}

// V@V - checks buy functions are reverting if pauseBuy is true
rule check_pauseBuy_functionality(method f, env e) filtered {f -> all_public_buy_methods(f)} {
    bool flagBuy = get_Buy_Paused(); // summarization

    calldataarg args;
    bool reverted_buy;
    
    if (f.selector == buyCollateral(address, uint, uint, address).selector) {
        buyCollateral@withrevert(e, args);
        reverted_buy = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted_buy = lastReverted;
    }

    // bool reverted_buy = buy_functions_with_revert(f, e);
    assert flagBuy => reverted_buy;
}