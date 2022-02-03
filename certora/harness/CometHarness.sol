// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "../../contracts/Comet.sol";
import "./CometMathHarness.sol";
import "./CometStorageHarness.sol";
import "../../contracts/ERC20.sol";
import "../../contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Compound's Comet Contract
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
contract CometHarness is Comet, CometMathHarness, CometStorageHarness {
    constructor(Configuration memory config) Comet(config) {
    }

    /*********** Simplification ***********/
    /* under approximation (not taking into account all possible cases) */
    function accrue(TotalsBasic memory totals) internal override view returns (TotalsBasic memory) {
        return totals;
    }

    /* safe approximation? (taking into account all possible cases) */
    
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicSupplyRate;
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicBorrowRate;
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicUtilization;
    
    function getSupplyRateInternal(TotalsBasic memory totals) internal view virtual override returns (uint64) {
        return symbolicSupplyRate[totals.totalSupplyBase][totals.totalBorrowBase];
    }

    function getBorrowRateInternal(TotalsBasic memory totals) internal  virtual override view returns (uint64) {
        return symbolicBorrowRate[totals.totalSupplyBase][totals.totalBorrowBase];

    }
    
    function getUtilizationInternal(TotalsBasic memory totals) internal view override returns  (uint) {
        return symbolicUtilization[totals.totalSupplyBase][totals.totalBorrowBase];
    }
    
    // getters
    function getUserCollateralBalance(address user, address asset) public returns (uint128) {
        return userCollateral[user][asset].balance;
    } 
     
 
}
