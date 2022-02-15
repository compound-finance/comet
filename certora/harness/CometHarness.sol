// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

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

    mapping (address => uint8) asset_index;

    function get_Index_Of_Collateral_Asset(address asset) public view returns (uint8){
        return asset_index[asset];
    }

    uint256 nonDet1;
    uint256 nonDet2;
    function _getPackedAsset(AssetConfig[] memory assetConfigs, uint i) internal override view returns (uint256, uint256) {
        return (nonDet1,nonDet2);
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
}
