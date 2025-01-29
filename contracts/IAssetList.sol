// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometCore.sol";

/**
 * @title Compound's Asset List
 * @author Compound
 */
interface IAssetList {
    function getAssetInfo(uint8 i) external view returns (CometCore.AssetInfo memory);
    function numAssets() external view returns (uint8);
}