// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometConfiguration.sol";
import "./IPriceFeed.sol";
import "./IERC20NonStandard.sol";
import "./CometMainInterface.sol";
import "./CometCore.sol";

/**
 * @title Compound's Asset List
 * @author Compound
 */
contract AssetList {
    /// @dev The decimals required for a price feed
    uint8 internal constant PRICE_FEED_DECIMALS = 8;

    /// @dev The scale for factors
    uint64 internal constant FACTOR_SCALE = 1e18;

    /// @dev The max value for a collateral factor (1)
    uint64 internal constant MAX_COLLATERAL_FACTOR = FACTOR_SCALE;

    uint256[] internal assets_a;
    uint256[] internal assets_b;

    /// @notice The number of assets this contract actually supports
    uint8 public immutable numAssets;
    
    constructor(CometConfiguration.AssetConfig[] memory assetConfigs) {
        uint8 _numAssets = uint8(assetConfigs.length);
        numAssets = _numAssets;
        uint256[] memory _assets_a = new uint256[](_numAssets);
        uint256[] memory _assets_b = new uint256[](_numAssets);
        for (uint i = 0; i < _numAssets; i++) {
            (uint256 asset_a, uint256 asset_b) = getPackedAssetInternal(assetConfigs, i);
            _assets_a[i] = asset_a;
            _assets_b[i] = asset_b;
        }
        assets_a = _assets_a;
        assets_b = _assets_b;
    }

    /**
     * @dev Checks and gets the packed asset info for storage
     */
    function getPackedAssetInternal(CometConfiguration.AssetConfig[] memory assetConfigs, uint i) internal view returns (uint256, uint256) {
        CometConfiguration.AssetConfig memory assetConfig;
        if (i < assetConfigs.length) {
            assembly {
                assetConfig := mload(add(add(assetConfigs, 0x20), mul(i, 0x20)))
            }
        } else {
            return (0, 0);
        }
        address asset = assetConfig.asset;
        address priceFeed = assetConfig.priceFeed;
        uint8 decimals_ = assetConfig.decimals;

        // Short-circuit if asset is nil
        if (asset == address(0)) {
            return (0, 0);
        }

        // Sanity check price feed and asset decimals
        if (IPriceFeed(priceFeed).decimals() != PRICE_FEED_DECIMALS) revert CometMainInterface.BadDecimals();
        if (IERC20NonStandard(asset).decimals() != decimals_) revert CometMainInterface.BadDecimals();

        // Ensure collateral factors are within range
        if (assetConfig.borrowCollateralFactor >= assetConfig.liquidateCollateralFactor) revert CometMainInterface.BorrowCFTooLarge();
        if (assetConfig.liquidateCollateralFactor > MAX_COLLATERAL_FACTOR) revert CometMainInterface.LiquidateCFTooLarge();

        unchecked {
            // Keep 4 decimals for each factor
            uint64 descale = FACTOR_SCALE / 1e4;
            uint16 borrowCollateralFactor = uint16(assetConfig.borrowCollateralFactor / descale);
            uint16 liquidateCollateralFactor = uint16(assetConfig.liquidateCollateralFactor / descale);
            uint16 liquidationFactor = uint16(assetConfig.liquidationFactor / descale);

            // Be nice and check descaled values are still within range
            if (borrowCollateralFactor >= liquidateCollateralFactor) revert CometMainInterface.BorrowCFTooLarge();

            // Keep whole units of asset for supply cap
            uint64 supplyCap = uint64(assetConfig.supplyCap / (10 ** decimals_));

            uint256 word_a = (uint160(asset) << 0 |
                              uint256(borrowCollateralFactor) << 160 |
                              uint256(liquidateCollateralFactor) << 176 |
                              uint256(liquidationFactor) << 192);
            uint256 word_b = (uint160(priceFeed) << 0 |
                              uint256(decimals_) << 160 |
                              uint256(supplyCap) << 168);

            return (word_a, word_b);
        }
    }

    /**
     * @notice Get the i-th asset info, according to the order they were passed in originally
     * @param i The index of the asset info to get
     * @return The asset info object
     */
    function getAssetInfo(uint8 i) public view returns (CometCore.AssetInfo memory) {
        if (i >= numAssets) revert CometMainInterface.BadAsset();

        uint256 word_a = assets_a[i];
        uint256 word_b = assets_b[i];

        address asset = address(uint160(word_a & type(uint160).max));
        uint64 rescale = FACTOR_SCALE / 1e4;
        uint64 borrowCollateralFactor = uint64(((word_a >> 160) & type(uint16).max) * rescale);
        uint64 liquidateCollateralFactor = uint64(((word_a >> 176) & type(uint16).max) * rescale);
        uint64 liquidationFactor = uint64(((word_a >> 192) & type(uint16).max) * rescale);

        address priceFeed = address(uint160(word_b & type(uint160).max));
        uint8 decimals_ = uint8(((word_b >> 160) & type(uint8).max));
        uint64 scale = uint64(10 ** decimals_);
        uint128 supplyCap = uint128(((word_b >> 168) & type(uint64).max) * scale);

        return CometCore.AssetInfo({
            offset: i,
            asset: asset,
            priceFeed: priceFeed,
            scale: scale,
            borrowCollateralFactor: borrowCollateralFactor,
            liquidateCollateralFactor: liquidateCollateralFactor,
            liquidationFactor: liquidationFactor,
            supplyCap: supplyCap
         });
    }
}