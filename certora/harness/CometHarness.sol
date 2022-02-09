// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "../../contracts/Comet.sol";
import "./CometHarnessGetters.sol";

import "../../contracts/ERC20.sol";
import "../../contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Certora's comet summarization contract
 * @notice 
 * @author Certora
 */
contract CometHarness is CometHarnessGetters {
    constructor(Configuration memory config) CometHarnessGetters(config) {
    }

    /*********** Simplification ***********/
    /* under approximation (not taking into account all possible cases) */
    // function accrue(TotalsBasic memory totals) internal override view returns (TotalsBasic memory) {
    //     return totals;
    // }

    /* safe approximation? (taking into account all possible cases) */
    
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicSupplyRate;
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicBorrowRate;
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicUtilization;
    
    // function getSupplyRateInternal(TotalsBasic memory totals) internal view virtual override returns (uint64) {
    //     return symbolicSupplyRate[totals.totalSupplyBase][totals.totalBorrowBase];
    // }
    function getSupplyRateInternal() internal view returns (uint64) {
        return symbolicSupplyRate[totalsBasic.totalSupplyBase][totalsBasic.totalBorrowBase];
    }

    // function getBorrowRateInternal(TotalsBasic memory totals) internal  virtual override view returns (uint64) {
    //     return symbolicBorrowRate[totals.totalSupplyBase][totals.totalBorrowBase];
    // }
    
    function getBorrowRateInternal() internal  view returns (uint64) {
        return symbolicBorrowRate[totalsBasic.totalSupplyBase][totalsBasic.totalBorrowBase];
    }
    function getUtilizationInternal() internal view returns  (uint) {
        return symbolicUtilization[totalsBasic.totalSupplyBase][totalsBasic.totalBorrowBase];
    }

}
