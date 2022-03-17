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
    function call_IsInAsset(uint16 assetsIn, uint8 assetOffset) external view returns (bool) {
        return isInAsset(assetsIn, assetOffset);
    }

    // external wrapper for updateAssetsIn()
    function call_updateAssetsIn(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance) external {
        updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    }

    // external wrapper for _getPackedAsset()
    function call__getPackedAsset(uint8 i, address assetArg, address priceFeedArg, uint8 decimalsArg, uint64 borrowCollateralFactorArg, uint64 liquidateCollateralFactorArg, uint64 liquidationFactorArg, uint128 supplyCapArg) public view returns (uint256, uint256) {
        AssetConfig memory assetConfigInst = AssetConfig({        
        asset: assetArg,
        priceFeed: priceFeedArg,
        decimals: decimalsArg,
        borrowCollateralFactor: borrowCollateralFactorArg,
        liquidateCollateralFactor: liquidateCollateralFactorArg,
        liquidationFactor: liquidationFactorArg,
        supplyCap: supplyCapArg
        });
        AssetConfig[] memory assetConfigs = new AssetConfig[](1);
        assetConfigs[0] = assetConfigInst;
        return super._getPackedAsset(assetConfigs, i);
    }

    function call_principalValue(int104 presentValue_) external view returns (int104) {
        return super.principalValue(presentValue_);
    }
    function call_presentValue(int104 principalValue_) external view returns (int104) {
        return super.presentValue(principalValue_);
    }
    function call_accrueInternal() external {
        return super.accrueInternal();
    }
    function call_getNowInternal() external view returns (uint40) {
        return super.getNowInternal();
    }
    // function call_allow(address owner, address manager, bool isAllowed_) external {
    //     return super.allowInternal(owner, manager, isAllowed);
    // }

    function get_asset00_a() public view returns (uint256){
        return asset00_a;
    }

    function get_asset00_b() public view returns (uint256){
        return asset00_b;
    }

    function exponent_of_ten(uint8 n) public pure returns (uint64){
        return uint64(uint64(10) ** n);
    }
    
    function call_hasPermission(address owner, address manager) public view returns (bool) {
        return hasPermission(owner, manager);
    }//
}
