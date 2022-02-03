
/*

General declarations of comet 

*/
methods {
    isBorrowCollateralized(address account) returns (bool) envfree;
    getUserCollateralBalance(address user, address asset) returns (uint128) envfree; 

    //under approxiamtion simplifications 
    decimals() returns uint8 => ALWAYS(1);
    latestRoundData() returns uint256 => CONSTANT;
}
