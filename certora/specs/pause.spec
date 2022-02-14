import "A_setupNoSummarization.spec"

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// pause revert only if the sender is not governor or pause guardian
rule check_flag_updates(/*bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused*/){
    env e; calldataarg args;
    require e.msg.value == 0;
    pause@withrevert(e, args/*supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused*/);
    bool isRevert = lastReverted;
    assert isRevert <=> (e.msg.sender != governor() && e.msg.sender != pauseGuardian()), "reverted although governor/guardian or not reverted";
}

// V@V - checks the integrity of getters  - after an update the getters retrieve same values as 
rule check_flag_getters(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused){
    env e;
    pause@withrevert(e, supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused);
    bool isRevert = lastReverted;
    bool flagSupply_ = isSupplyPaused();
    bool flagTransfer_ = isTransferPaused();
    bool flagWithdraw_ = isWithdrawPaused();
    bool flagAbsorb_ = isAbsorbPaused();
    bool flagBuy_ = isBuyPaused();
    assert !isRevert => flagSupply_ == supplyPaused, "supply flag update done wrongfully";
    assert !isRevert => flagTransfer_ == transferPaused, "transfer flag update done wrongfully";
    assert !isRevert => flagWithdraw_ == withdrawPaused, "withdraw flag update done wrongfully";
    assert !isRevert => flagAbsorb_ == absorbPaused, "absorb flag update done wrongfully";
    assert !isRevert => flagBuy_ == buyPaused, "buy flag update done wrongfully";
}

// B@B - checks supply functions are reverting if pauseSupply is true
rule check_pauseSupply_functionallity(method f, env e) filtered {f -> all_public_supply_methods(f)} {
    bool flagSupply = isSupplyPaused();    
    bool reverted_supply = supply_functions_with_revert(f, e);
    assert flagSupply => reverted_supply;
}

// B@B - checks transfer functions are reverting if pauseTransfer is true
rule check_pauseTransfer_functionallity(method f, env e) filtered {f -> all_public_transfer_methods(f)} {
    bool flagTransfer = isTransferPaused();
    bool reverted_transfer = transfer_functions_with_revert(f, e);
    assert flagTransfer => reverted_transfer;
}

// B@B - checks withdraw functions are reverting if pauseWithdraw is true
rule check_pauseWithdraw_functionallity(method f, env e) filtered {f -> all_public_withdraw_methods(f)} {
    bool flagWithdraw = isWithdrawPaused();
    bool reverted_withdraw = withdraw_functions_with_revert(f, e);
    assert flagWithdraw => reverted_withdraw;
}

// B@B - checks absorb functions are reverting if pauseAbsorb is true
rule check_pauseAbsorb_functionallity(method f, env e) filtered {f -> all_public_absorb_methods(f)} {
    bool flagAbsorb = isAbsorbPaused();
    bool reverted_absorb = absorb_functions_with_revert(f, e);
    assert flagAbsorb => reverted_absorb;
}

// B@B - checks buy functions are reverting if pauseBuy is true
rule check_pauseBuy_functionallity(method f, env e) filtered {f -> all_public_buy_methods(f)} {
    bool flagBuy = isBuyPaused();
    bool reverted_buy = buy_functions_with_revert(f, e);
    assert flagBuy => reverted_buy;
}