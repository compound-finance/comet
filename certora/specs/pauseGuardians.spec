/*
    This is a specification file for the verification of Comet.sol
    smart contract using the Certora prover. For more information,
	visit: https://www.certora.com/

    This file is run with scripts/verifyPauseGuardians.sh

    This file contains rules related to validity of pausing the system.
*/
import "setup_cometSummarization.spec"

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////   Properties   ///////////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
//  @Complete Run: https://vaas-stg.certora.com/output/44289/fd7593841f1bfb3f09ed/?anonymousKey=b1106e54098acbe885e603a65e61e777425d4cbf

/*
    @Rule

    @Description:
        Checks supply functions are reverting if pauseSupply is true.

    @Formula:
        {
            flagSupply = get_supply_paused()
        }

        < call any supply function >

        {
            flagSupply => revert
        }

    @Notes:
        Checked on all 3 supply functions

    @Link:
        https://vaas-stg.certora.com/output/44289/a534afa257cbbaba166f/?anonymousKey=d9dba8d11b27e6080c0be78fcf34faa6a82404aa
*/

rule check_pauseSupply_functionality(method f, env e) filtered {f -> all_public_supply_methods(f)} {
    bool flagSupply = get_supply_paused(); // summarization

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

    assert flagSupply => reverted_supply;
}


/*
    @Rule

    @Description:
        checks transfer functions are reverting if pauseTransfer is true.

    @Formula:
        {
            flagTransfer = get_transfer_paused()
        }

        < call any transfer function >
        
        {
            flagTransfer => revert
        }

    @Notes:
        Checked on both transfer functions

    @Link:
        https://vaas-stg.certora.com/output/44289/e68f2912fa8d9255c585/?anonymousKey=ac6a6b3111e00a489fbb327f5e1ca203d06e85c1
*/

rule check_pauseTransfer_functionality(method f, env e) filtered {f -> all_public_transfer_methods(f)} {
    bool flagTransfer = get_transfer_paused(); // summarization
    
    calldataarg args;
    bool reverted_transfer;
    if (f.selector == transferAsset(address, address, uint).selector) {
        transferAsset@withrevert(e, args);
        reverted_transfer = lastReverted;
    } else if (f.selector == transferAssetFrom(address, address, address, uint).selector) {
        transferAssetFrom@withrevert(e, args);
        reverted_transfer = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted_transfer = lastReverted;
    }
    
    assert flagTransfer => reverted_transfer;
}


/*
    @Rule

    @Description:
        checks withdraw functions are reverting if pauseWithdraw is true

    @Formula:
        {
            flagWithdraw = get_withdraw_paused()
        }

        < call any withdraw function >
        
        {
            flagWithdraw => revert
        }

    @Notes:
        Checked on all 3 withdraw functions

    @Link:
        https://vaas-stg.certora.com/output/44289/94e8584987759917a93a/?anonymousKey=465e987cc0aed5c9db75b6e9a776813262e313bd
*/

rule check_pauseWithdraw_functionality(method f, env e) filtered {f -> all_public_withdraw_methods(f)} {
    bool flagWithdraw = get_withdraw_paused(); // summarization

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

    assert flagWithdraw => reverted_withdraw;
}


/*
    @Rule

    @Description:
        checks absorb functions are reverting if pauseAbsorb is true

    @Formula:
        {
            flagAbsorb = get_absorb_paused()
        }

        < call any absorb function >
        
        {
            flagAbsorb => revert
        }

    @Notes:

    @Link:
        https://vaas-stg.certora.com/output/44289/c814d6d628223a274101/?anonymousKey=caf7b0c67138f130be7bc804ce41985da2e7e4f8
*/

rule check_pauseAbsorb_functionality(method f, env e) filtered {f -> all_public_absorb_methods(f)} {
    bool flagAbsorb = get_absorb_paused(); // summarization

    calldataarg args;
    bool reverted_absorb;
    
    if (f.selector == absorb(address, address[]).selector) {
        absorb@withrevert(e, args);
        reverted_absorb = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted_absorb = lastReverted;
    }

    assert flagAbsorb => reverted_absorb;
}


/*
    @Rule

    @Description:
        checks buy functions are reverting if pauseBuy is true

    @Formula:
        {
            flagBuy = get_buy_paused()
        }

        < call any buy function >
        
        {
            flagBuy => revert
        }

    @Note:

    @Link:
        https://vaas-stg.certora.com/output/44289/5404a5c669fcf693ad06/?anonymousKey=27a47ff7f88d83cd7861c85bf676e6f947c6d5c4
*/

rule check_pauseBuy_functionality(method f, env e) filtered {f -> all_public_buy_methods(f)} {
    bool flagBuy = get_buy_paused(); // summarization

    calldataarg args;
    bool reverted_buy;
    
    if (f.selector == buyCollateral(address, uint, uint, address).selector) {
        buyCollateral@withrevert(e, args);
        reverted_buy = lastReverted;
    } else{
        f@withrevert(e, args);
        reverted_buy = lastReverted;
    }

    assert flagBuy => reverted_buy;
}