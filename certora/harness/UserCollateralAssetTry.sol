// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../../contracts/CometCore.sol";

contract UserCollateralAssetTry is CometCore {
    
    /// @notice The number of assets this contract actually supports
    uint8 public immutable numAssets;
    uint16 public assetsInOfUser;

    /**  Collateral asset configuration (packed) **/

    uint256 internal immutable asset00_a;
    uint256 internal immutable asset00_b;
    uint256 internal immutable asset01_a;
    uint256 internal immutable asset01_b;
    uint256 internal immutable asset02_a;
    uint256 internal immutable asset02_b;
    uint256 internal immutable asset03_a;
    uint256 internal immutable asset03_b;
    uint256 internal immutable asset04_a;
    uint256 internal immutable asset04_b;
    uint256 internal immutable asset05_a;
    uint256 internal immutable asset05_b;
    uint256 internal immutable asset06_a;
    uint256 internal immutable asset06_b;
    uint256 internal immutable asset07_a;
    uint256 internal immutable asset07_b;
    uint256 internal immutable asset08_a;
    uint256 internal immutable asset08_b;
    uint256 internal immutable asset09_a;
    uint256 internal immutable asset09_b;
    uint256 internal immutable asset10_a;
    uint256 internal immutable asset10_b;
    uint256 internal immutable asset11_a;
    uint256 internal immutable asset11_b;
    uint256 internal immutable asset12_a;
    uint256 internal immutable asset12_b;
    uint256 internal immutable asset13_a;
    uint256 internal immutable asset13_b;
    uint256 internal immutable asset14_a;
    uint256 internal immutable asset14_b;

constructor(Configuration memory config) {

        // Set asset info
        numAssets = uint8(config.assetConfigs.length);

        (asset00_a, asset00_b) = _getPackedAsset(config.assetConfigs, 0);
        (asset01_a, asset01_b) = _getPackedAsset(config.assetConfigs, 1);
        (asset02_a, asset02_b) = _getPackedAsset(config.assetConfigs, 2);
        (asset03_a, asset03_b) = _getPackedAsset(config.assetConfigs, 3);
        (asset04_a, asset04_b) = _getPackedAsset(config.assetConfigs, 4);
        (asset05_a, asset05_b) = _getPackedAsset(config.assetConfigs, 5);
        (asset06_a, asset06_b) = _getPackedAsset(config.assetConfigs, 6);
        (asset07_a, asset07_b) = _getPackedAsset(config.assetConfigs, 7);
        (asset08_a, asset08_b) = _getPackedAsset(config.assetConfigs, 8);
        (asset09_a, asset09_b) = _getPackedAsset(config.assetConfigs, 9);
        (asset10_a, asset10_b) = _getPackedAsset(config.assetConfigs, 10);
        (asset11_a, asset11_b) = _getPackedAsset(config.assetConfigs, 11);
        (asset12_a, asset12_b) = _getPackedAsset(config.assetConfigs, 12);
        (asset13_a, asset13_b) = _getPackedAsset(config.assetConfigs, 13);
        (asset14_a, asset14_b) = _getPackedAsset(config.assetConfigs, 14);
    }

    /**
     * @dev Gets the info for an asset or empty, for initialization
     */
    function _getAssetConfig(AssetConfig[] memory assetConfigs, uint i) public pure returns (AssetConfig memory) {
        if (i < assetConfigs.length)
            return assetConfigs[i];
        return AssetConfig({
            asset: address(0),
            priceFeed: address(0),
            decimals: uint8(0),
            borrowCollateralFactor: uint64(0),
            liquidateCollateralFactor: uint64(0),
            liquidationFactor: uint64(0),
            supplyCap: uint128(0)
        });
    }

    /**
     * @dev Checks and gets the packed asset info for storage
     */
    function _getPackedAsset(AssetConfig[] memory assetConfigs, uint i) public view virtual returns (uint256, uint256) {
        AssetConfig memory assetConfig = _getAssetConfig(assetConfigs, i);
        address asset = assetConfig.asset;
        address priceFeed = assetConfig.priceFeed;
        uint8 decimals_ = assetConfig.decimals;

        // Short-circuit if asset is nil
        if (asset == address(0)) {
            return (0, 0);
        }

        // Keep 4 decimals for each factor
        uint descale = FACTOR_SCALE / 1e4;
        uint16 borrowCollateralFactor = uint16(assetConfig.borrowCollateralFactor / descale);
        uint16 liquidateCollateralFactor = uint16(assetConfig.liquidateCollateralFactor / descale);
        uint16 liquidationFactor = uint16(assetConfig.liquidationFactor / descale);

        // Be nice and check descaled values are still within range
        require(borrowCollateralFactor < liquidateCollateralFactor, "borrow CF must be < liquidate CF");

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

    /**
     * @notice Get the i-th asset info, according to the order they were passed in originally
     * @param i The index of the asset info to get
     * @return The asset info object
     */
    function getAssetInfo(uint8 i) virtual public view returns (AssetInfo memory) {
        require(i < numAssets, "asset info not found");

        uint256 word_a;
        uint256 word_b;

        if (i == 0) {
            word_a = asset00_a;
            word_b = asset00_b;
        } else if (i == 1) {
            word_a = asset01_a;
            word_b = asset01_b;
        } else if (i == 2) {
            word_a = asset02_a;
            word_b = asset02_b;
        } else if (i == 3) {
            word_a = asset03_a;
            word_b = asset03_b;
        } else if (i == 4) {
            word_a = asset04_a;
            word_b = asset04_b;
        } else if (i == 5) {
            word_a = asset05_a;
            word_b = asset05_b;
        } else if (i == 6) {
            word_a = asset06_a;
            word_b = asset06_b;
        } else if (i == 7) {
            word_a = asset07_a;
            word_b = asset07_b;
        } else if (i == 8) {
            word_a = asset08_a;
            word_b = asset08_b;
        } else if (i == 9) {
            word_a = asset09_a;
            word_b = asset09_b;
        } else if (i == 10) {
            word_a = asset10_a;
            word_b = asset10_b;
        } else if (i == 11) {
            word_a = asset11_a;
            word_b = asset11_b;
        } else if (i == 12) {
            word_a = asset12_a;
            word_b = asset12_b;
        } else if (i == 13) {
            word_a = asset13_a;
            word_b = asset13_b;
        } else if (i == 14) {
            word_a = asset14_a;
            word_b = asset14_b;
        } else {
            revert("absurd");
        }

        address asset = address(uint160(word_a & type(uint160).max));
        uint rescale = FACTOR_SCALE / 1e4;
        uint64 borrowCollateralFactor = uint64(((word_a >> 160) & type(uint16).max) * rescale);
        uint64 liquidateCollateralFactor = uint64(((word_a >> 176) & type(uint16).max) * rescale);
        uint64 liquidationFactor = uint64(((word_a >> 192) & type(uint16).max) * rescale);

        address priceFeed = address(uint160(word_b & type(uint160).max));
        uint8 decimals_ = uint8(((word_b >> 160) & type(uint8).max));
        uint64 scale = uint64(10 ** decimals_);
        uint128 supplyCap = uint128(((word_b >> 168) & type(uint64).max) * scale);

        return AssetInfo({
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

    /**
     * @dev Determine index of asset that matches given address
     */
    function getAssetInfoByAddress(address asset) public view returns (AssetInfo memory) {
        for (uint8 i = 0; i < numAssets; i++) {
            AssetInfo memory assetInfo = getAssetInfo(i);
            if (assetInfo.asset == asset) {
                return assetInfo;
            }
        }
        revert("asset not found");
    }

    /**
     * @dev Whether user has a non-zero balance of an asset, given assetsIn flags
     */
    function isInAsset2(uint16 assetsIn, uint8 assetOffset) virtual public view returns (bool) {
        return (assetsIn & (uint8(1) << (assetOffset)) != 0);
    }

    /**
     * @dev Update assetsIn bit vector if user has entered or exited an asset
     */
    function updateAssetsIn2(
        address asset,
        uint128 initialUserBalance,
        uint128 finalUserBalance
    ) virtual public {
        AssetInfo memory assetInfo = getAssetInfoByAddress(asset);
        if (initialUserBalance == 0 && finalUserBalance != 0) {
            // set bit for asset
            assetsInOfUser |= (uint16(1) << assetInfo.offset);
        } else if (initialUserBalance != 0 && finalUserBalance == 0) {
            // clear bit for asset
            assetsInOfUser &= ~(uint16(1) << assetInfo.offset);
        }
    }

    function getAssetOffsetByAsset(address asset) public view returns (uint8 offset) {
        AssetInfo memory assetInfo = getAssetInfoByAddress(asset);
        return assetInfo.offset;
    }
}