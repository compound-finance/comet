import "A_setupNoSummarization.spec"

////////////////////////////////////////////////////////////////////////////////
////////////////////////////   Getters & Update   //////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// V@V - pause revert only if the sender is not governor or pause guardian
rule check_flag_updates(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused){
    env e;
    require e.msg.value == 0;
    pause@withrevert(e, supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused);
    bool isRevert = lastReverted;
    assert isRevert <=> (e.msg.sender != governor() && e.msg.sender != pauseGuardian()), "reverted although sender is either governor or guardian";
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