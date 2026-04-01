// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;
import "./CometCore.sol";

/**
 * @title Compound's Asset List Factory
 * @author Compound
 */
interface IAssetListFactory {
    /**
     * @notice Create a new asset list
     * @param assetConfigs The asset configurations
     * @param targetHealthFactor The target health factor for the asset list, used for validation
     * @return assetList The address of the new asset list
     */
    function createAssetList(CometCore.AssetConfig[] memory assetConfigs, uint targetHealthFactor) external returns (address assetList);
}