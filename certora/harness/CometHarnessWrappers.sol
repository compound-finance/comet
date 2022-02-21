// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometHarnessGetters.sol";
import "../../contracts/ERC20.sol";
import "../../contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Certora's comet harness wrappers contract
 * @notice wrappers for internal function checks
 * @author Certora
 */
contract CometHarnessWrappers is CometHarnessGetters {
    constructor(Configuration memory config) CometHarnessGetters(config) { }
    
    // external wrapper for isInAsset()
    function call_IsInAsset(uint16 assetsIn, uint8 assetOffset) external pure returns (bool) {
        return super.isInAsset(assetsIn, assetOffset);
    }

    // external wrapper for updateAssetsIn()
    function call_updateAssetsIn(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance) external {
        super.updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    }

    // external wrapper for _getPackedAsset()
    function call__getPackedAsset(AssetConfig[] memory assetConfigs, uint i) internal view returns (uint256, uint256) {
        return super._getPackedAsset(assetConfigs, i);
    }
    function call_principalValue(int104 presentValue_) external returns (int104) {
        TotalsBasic memory totals = totalsBasic;
        return super.principalValue(totals, presentValue_);
    }
    function call_presentValue(int104 principalValue_) external returns (int104) {
        TotalsBasic memory totals = totalsBasic;
        return super.presentValue(totals, principalValue_);
    }

}
