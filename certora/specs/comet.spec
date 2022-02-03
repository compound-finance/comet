
/*

General declarations of comet 

*/
methods {
    isBorrowCollateralized(address account) returns (bool) envfree;
    getUserCollateralBalance(address user, address asset) returns (uint128) envfree; 

    //under approxiamtion simplifications 
    decimals() returns uint8 => ALWAYS(1);
    latestRoundData() returns uint256 => CONSTANT;
   /*  pause(
        bool supplyPaused,
        bool transferPaused,
        bool withdrawPaused,
        bool absorbPaused,
        bool buyPaused
    ) => updatePause(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused) */
    /*updateAssetsIn(
        address account,
        address asset,
        uint128 initialUserBalance,
        uint128 finalUserBalance
    ) => NONDET
    */
    isInAsset(uint16 assetsIn, uint8 assetOffset) => NONDET

}

/*
ghost supplyPausedGhost bool;

function updatePause(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused) {
    supplyPausedGhost = supplyPaused
}
*/