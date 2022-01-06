// SPDX-License-Identifier: ADD VALID LICENSE
pragma solidity ^0.8.0;

contract Comet {
     struct AssetInfo {
        address asset;
        uint borrowCollateralFactor;
        uint liquidateCollateralFactor;
    }

    struct Configuration {
        address governor;
        address priceOracle;
        address baseToken;

        AssetInfo[] assetInfo;
    }

    /// @notice The max number of assets this contract is hardcoded to support
    /// @dev Do not change this variable without updating all the fields throughout the contract.
    uint public constant maxAssets = 2;
    /// @notice The number of assets this contract actually supports
    uint public immutable numAssets;

    // Configuration constants
    address public immutable governor;
    address public immutable priceOracle;
    address public immutable baseToken;

    address internal immutable asset00;
    address internal immutable asset01;

    uint internal immutable borrowCollateralFactor00;
    uint internal immutable borrowCollateralFactor01;

    uint internal immutable liquidateCollateralFactor00;
    uint internal immutable liquidateCollateralFactor01;

    constructor(Configuration memory config) {
        require(config.assetInfo.length <= maxAssets, "too many asset configs");

         // Set configuration variables
        governor = config.governor;
        priceOracle = config.priceOracle;
        baseToken = config.baseToken;

        // Set asset info
        numAssets = config.assetInfo.length;

        asset00 = getAssetFromArray(config.assetInfo, 0).asset;
        asset01 = getAssetFromArray(config.assetInfo, 1).asset;

        borrowCollateralFactor00 = getAssetFromArray(config.assetInfo, 0).borrowCollateralFactor;
        borrowCollateralFactor01 = getAssetFromArray(config.assetInfo, 1).borrowCollateralFactor;

        liquidateCollateralFactor00 = getAssetFromArray(config.assetInfo, 0).liquidateCollateralFactor;
        liquidateCollateralFactor01 = getAssetFromArray(config.assetInfo, 1).liquidateCollateralFactor;
    }

    function getAssetFromArray(AssetInfo[] memory assetInfo, uint i) internal pure returns (AssetInfo memory) {
        if (i < assetInfo.length)
            return assetInfo[i];
        return AssetInfo({
            asset: address(0),
            borrowCollateralFactor: uint256(0),
            liquidateCollateralFactor: uint256(0)
        });
    }

    /**
     * @notice Get the i-th asset info, according to the order they were passed in originally
     * @param i The index of the asset info to get
     * @return The asset info object
     */
    function getAssetInfo(uint i) public view returns (AssetInfo memory) {
        require(i < numAssets, "asset info not found");

        if (i == 0) return AssetInfo({asset: asset00, borrowCollateralFactor: borrowCollateralFactor00, liquidateCollateralFactor: liquidateCollateralFactor00 });
        if (i == 1) return AssetInfo({asset: asset01, borrowCollateralFactor: borrowCollateralFactor01, liquidateCollateralFactor: liquidateCollateralFactor01 });
    }
}
