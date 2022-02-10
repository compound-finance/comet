import "A_setupNoSummarization.spec"

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//

// checks the integrity of getters  - after an update the getters retrieve same values as 
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