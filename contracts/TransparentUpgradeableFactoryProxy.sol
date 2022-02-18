// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometFactory.sol";
import "./CometStorage.sol";
import "./CometConfiguration.sol";
import "./vendor/proxy/TransparentUpgradeableProxy.sol";

contract TransparentUpgradeableFactoryProxy is TransparentUpgradeableProxy, CometStorage {
    address public factory;

    /**
     * @dev Initializes an upgradeable proxy managed by `_admin`, backed by the implementation at `_logic`, and
     * optionally initialized with `_data` as explained in {UpgradeableProxy-constructor}.
     */
    constructor(address factory_, address _logic, address _admin, bytes memory _data) payable TransparentUpgradeableProxy(_logic, _admin, _data) {
        factory = factory_;
    }

    // XXX Test that this is only callable by an admin
    /**
     * @dev Deploy and upgrade the implementation of the proxy.
     *
     * NOTE: Only the admin can call this function. See {ProxyAdmin-deployAndUpgrade}.
     */
    function deployAndUpgrade() external ifAdmin {
        PackedAssetConfig[] memory _packedAssetConfigs = _getPackedAssets(assetConfigsParam);
        Configuration memory configuratorParams = Configuration({
            governor: governorParam,
            pauseGuardian: pauseGuardianParam,
            baseToken: baseTokenParam,
            baseTokenPriceFeed: baseTokenPriceFeedParam,
            extensionDelegate: extensionDelegateParam,
            kink: kinkParam,
            perYearInterestRateSlopeLow: perYearInterestRateSlopeLowParam,
            perYearInterestRateSlopeHigh: perYearInterestRateSlopeHighParam,
            perYearInterestRateBase: perYearInterestRateBaseParam,
            reserveRate: reserveRateParam,
            trackingIndexScale: trackingIndexScaleParam,
            baseTrackingSupplySpeed: baseTrackingSupplySpeedParam,
            baseTrackingBorrowSpeed: baseTrackingBorrowSpeedParam,
            baseMinForRewards: baseMinForRewardsParam,
            baseBorrowMin: baseBorrowMinParam,
            targetReserves: targetReservesParam,
            packedAssetConfigs: _packedAssetConfigs
        });
        
        // Deploy Comet
        address newComet = CometFactory(factory).clone(configuratorParams);
        _upgradeTo(newComet);
    }

    // XXX see if there is a cleaner way to do this
    function setConfiguration(ConfiguratorConfiguration memory config) external ifAdmin {
        governorParam = config.governor;
        pauseGuardianParam = config.pauseGuardian;
        baseTokenParam = config.baseToken;
        baseTokenPriceFeedParam = config.baseTokenPriceFeed;
        extensionDelegateParam = config.extensionDelegate;
        kinkParam = config.kink;
        perYearInterestRateSlopeLowParam = config.perYearInterestRateSlopeLow;
        perYearInterestRateSlopeHighParam = config.perYearInterestRateSlopeHigh;
        perYearInterestRateBaseParam = config.perYearInterestRateBase;
        reserveRateParam = config.reserveRate;
        trackingIndexScaleParam = config.trackingIndexScale;
        baseTrackingSupplySpeedParam = config.baseTrackingSupplySpeed;
        baseTrackingBorrowSpeedParam = config.baseTrackingBorrowSpeed;
        baseMinForRewardsParam = config.baseMinForRewards;
        baseBorrowMinParam = config.baseBorrowMin;
        targetReservesParam = config.targetReserves;

        // Need to copy using this loop because directly copying of an array of structs is not supported
        for (uint256 i = 0; i < config.assetConfigs.length; i++) {
            if (i < assetConfigsParam.length) {
                assetConfigsParam[i] = config.assetConfigs[i];
            } else {
                assetConfigsParam.push(config.assetConfigs[i]);
            }
        }
    }

    /**
     * @dev Gets the info for an asset or empty, for initialization
     */
    function _getAssetConfig(AssetConfig[] memory assetConfigs, uint i) internal pure returns (AssetConfig memory) {
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
    function _getPackedAssetHelper(AssetConfig[] memory assetConfigs, uint i) internal view returns (uint, uint) {
        AssetConfig memory assetConfig = _getAssetConfig(assetConfigs, i);
        address asset = assetConfig.asset;
        address priceFeed = assetConfig.priceFeed;
        uint8 decimals = assetConfig.decimals;

        // Short-circuit if asset is nil
        if (asset == address(0)) {
            return (0, 0);
        }

        // XXX Should we add back these checks?
        // Sanity check price feed and asset decimals
        // require(AggregatorV3Interface(priceFeed).decimals() == priceFeedDecimals, "bad price feed decimals");
        // require(ERC20(asset).decimals() == decimals, "asset decimals mismatch");

        // // Ensure collateral factors are within range
        // require(assetConfig.borrowCollateralFactor < assetConfig.liquidateCollateralFactor, "borrow CF must be < liquidate CF");
        // require(assetConfig.liquidateCollateralFactor <= maxCollateralFactor, "liquidate CF too high");

        // Keep 4 decimals for each factor
        uint descale = FACTOR_SCALE / 1e4;
        uint16 borrowCollateralFactor = uint16(assetConfig.borrowCollateralFactor / descale);
        uint16 liquidateCollateralFactor = uint16(assetConfig.liquidateCollateralFactor / descale);
        uint16 liquidationFactor = uint16(assetConfig.liquidationFactor / descale);

        // Be nice and check descaled values are still within range
        require(borrowCollateralFactor < liquidateCollateralFactor, "borrow CF must be < liquidate CF");

        // Keep whole units of asset for supply cap
        uint64 supplyCap = uint64(assetConfig.supplyCap / (10 ** decimals));

        uint256 word_a = (uint160(asset) << 0 |
                          uint256(borrowCollateralFactor) << 160 |
                          uint256(liquidateCollateralFactor) << 176 |
                          uint256(liquidationFactor) << 192);
        uint256 word_b = (uint160(priceFeed) << 0 |
                          uint256(decimals) << 160 |
                          uint256(supplyCap) << 168);

        return (word_a, word_b);
    }

    function _getPackedAssets(AssetConfig[] memory assetConfigs) internal view returns (PackedAssetConfig[] memory) {
        PackedAssetConfig[] memory packedAssetConfigs = new PackedAssetConfig[](MAX_ASSETS);
        for (uint256 i = 0; i < MAX_ASSETS; i++) {
            (uint word_a, uint word_b) = _getPackedAssetHelper(assetConfigs, i);
            PackedAssetConfig memory packedAssetConfig = PackedAssetConfig({ word_a: word_a, word_b: word_b });
            packedAssetConfigs[i] = packedAssetConfig;
        }
        return packedAssetConfigs;
    }


    // XXX Define other setters for setting params
    function setGovernor(address governor) external ifAdmin {
        governorParam = governor;
    }

    // XXX What about removing an asset?
    function addAsset(AssetConfig calldata asset) external ifAdmin {
        assetConfigsParam.push(asset);
    }
}