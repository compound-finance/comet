// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;
import "./CometCore.sol";

/**
 * @title Compound's Asset List Factory
 * @author Compound
 */
interface IAssetListFactory {
    function createAssetList(CometCore.AssetConfig[] memory assetConfigs) external returns (address assetList);
}