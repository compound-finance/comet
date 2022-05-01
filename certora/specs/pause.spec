/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyPause.sh

    This file contains rules related to modeling and updating pause flags.
*/
import "setup_noSummarization.spec"

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/0123d879e2bb504d510c/?anonymousKey=68362fb76d5752a267d8de6e385e512cfd7f05d4

/*
    @Rule

    @Description:
        pause revert if only if the sender is not governor or pause guardian

    @Formula:
        {

        }
            pause()
        {
            revert <=> (msg.sender != governor && msg.sender != pauseGuardian)
        }

    @Note:

    @Link:
        https://vaas-stg.certora.com/output/44289/aec9938177320f5f4e0b/?anonymousKey=a1c9246f90a625038e25b3a898610d4c0c7d20a6
*/

rule ability_to_update_flags(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused){
    env e;
    require e.msg.value == 0;
    pause@withrevert(e, supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused);
    bool isRevert = lastReverted;
    assert isRevert <=> (e.msg.sender != governor() && e.msg.sender != pauseGuardian()), "reverted although sender is either governor or guardian";
}


/*
    @Rule

    @Description:
        checks the integrity of getters  - after an update the getters retrieve same values as sent when called to pause

    @Formula:
        {

        }

        pause(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused)

        {
            !lastRevert => ( supplyPaused = supplyPaused() &&
            transferPaused = isTransferPaused() &&
            withdrawPaused = isWithdrawPaused() &&
            absorbPaused = isAbsorbPaused() &&
            buyPaused = isBuyPaused() )        
        }

    @Note:

    @Link:
        https://vaas-stg.certora.com/output/44289/42b33ca481471f064fde/?anonymousKey=3f76285b08be14481b9efa4eb7e04fc60dabaa3b
*/

rule integrity_of_flag_updates(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused){
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