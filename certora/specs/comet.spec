
/*

General declarations of comet 

*/
methods {
    isBorrowCollateralized(address account) returns (bool) envfree;
    getUserCollateralBalance(address user, address asset) returns (uint128) envfree; 
}
