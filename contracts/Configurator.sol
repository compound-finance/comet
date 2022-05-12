// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.13;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./ConfiguratorStorage.sol";

contract Configurator is ConfiguratorStorage {

    /** Custom events **/

    event AddAsset(AssetConfig assetConfig);
    event CometDeployed(address newComet);
    event GovernorTransferred(address oldGovernor, address newGovernor);
    event SetFactory(address oldFactory, address newFactory);
    event SetGovernor(address oldGovernor, address newGovernor);
    event SetPauseGuardian(address oldPauseGuardian, address newPauseGuardian);
    event SetBaseTokenPriceFeed(address oldBaseTokenPriceFeed, address newBaseTokenPriceFeed);
    event SetExtensionDelegate(address oldExt, address newExt);
    event SetKink(uint64 oldKink, uint64 newKink);
    event SetPerYearInterestRateSlopeLow(uint64 oldIRSlopeLow, uint64 newIRSlopeLow);
    event SetPerYearInterestRateSlopeHigh(uint64 oldIRSlopeHigh, uint64 newIRSlopeHigh);
    event SetPerYearInterestRateBase(uint64 oldIRBase, uint64 newIRBase);
    event SetReserveRate(uint64 oldReserveRate, uint64 newReserveRate);
    event SetStoreFrontPriceFactor(uint64 oldStoreFrontPriceFactor, uint64 newStoreFrontPriceFactor);
    event SetBaseTrackingSupplySpeed(uint64 oldBaseTrackingSupplySpeed, uint64 newBaseTrackingSupplySpeed);
    event SetBaseTrackingBorrowSpeed(uint64 oldBaseTrackingBorrowSpeed, uint64 newBaseTrackingBorrowSpeed);
    event SetBaseMinForRewards(uint104 oldBaseMinForRewards, uint104 newBaseMinForRewards);
    event SetBaseBorrowMin(uint104 oldBaseBorrowMin, uint104 newBaseBorrowMin);
    event SetTargetReserves(uint104 oldTargetReserves, uint104 newTargetReserves);
    event UpdateAsset(AssetConfig oldAssetConfig, AssetConfig newAssetConfig);
    event UpdateAssetPriceFeed(address indexed asset, address oldPriceFeed, address newPriceFeed);
    event UpdateAssetBorrowCollateralFactor(address indexed asset, uint64 oldBorrowCF, uint64 newBorrowCF);
    event UpdateAssetLiquidateCollateralFactor(address indexed asset, uint64 oldLiquidateCF, uint64 newLiquidateCF);
    event UpdateAssetLiquidationFactor(address indexed asset, uint64 oldLiquidationFactor, uint64 newLiquidationFactor);
    event UpdateAssetSupplyCap(address indexed asset, uint128 oldSupplyCap, uint128 newSupplyCap);

    /** Custom errors **/

    error AlreadyInitialized();
    error AssetDoesNotExist();
    error InvalidAddress();
    error Unauthorized();

    /// @notice Initializes the storage for Configurator
    function initialize(address _governor, address _factory, Configuration calldata _config) public {
        if (version != 0) revert AlreadyInitialized();
        if (_governor == address(0)) revert InvalidAddress();
        if (_factory == address(0)) revert InvalidAddress();

        governor = _governor;
        factory = _factory;
        configuratorParams = _config;
        version = 1;
    }

    /// @notice Sets the factory for Configurator
    /// @dev only callable by governor
    function setFactory(address newFactory) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldFactory = factory;
        factory = newFactory;
        emit SetFactory(oldFactory, newFactory);
    }

    /** Setters for Comet-related configuration **/
    /**
    * The following configuration parameters do not have setters:
    *   - BaseToken
    *   - TrackingIndexScale
    */

    /// @dev only callable by governor
    function setGovernor(address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldGovernor = configuratorParams.governor;
        configuratorParams.governor = newGovernor;
        emit SetGovernor(oldGovernor, newGovernor);
    }

    /// @dev only callable by governor
    function setPauseGuardian(address newPauseGuardian) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldPauseGuardian = configuratorParams.pauseGuardian;
        configuratorParams.pauseGuardian = newPauseGuardian;
        emit SetPauseGuardian(oldPauseGuardian, newPauseGuardian);
    }

    /// @dev only callable by governor
    function setBaseTokenPriceFeed(address newBaseTokenPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldBaseTokenPriceFeed = configuratorParams.baseTokenPriceFeed;
        configuratorParams.baseTokenPriceFeed = newBaseTokenPriceFeed;
        emit SetBaseTokenPriceFeed(oldBaseTokenPriceFeed, newBaseTokenPriceFeed);
    }

    /// @dev only callable by governor
    function setExtensionDelegate(address newExtensionDelegate) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldExtensionDelegate = configuratorParams.extensionDelegate;
        configuratorParams.extensionDelegate = newExtensionDelegate;
        emit SetExtensionDelegate(oldExtensionDelegate, newExtensionDelegate);
    }

    /// @dev only callable by governor
    function setKink(uint64 newKink) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldKink = configuratorParams.kink;
        configuratorParams.kink = newKink;
        emit SetKink(oldKink, newKink);
    }

    /// @dev only callable by governor
    function setPerYearInterestRateSlopeLow(uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldSlope = configuratorParams.perYearInterestRateSlopeLow;
        configuratorParams.perYearInterestRateSlopeLow = newSlope;
        emit SetPerYearInterestRateSlopeLow(oldSlope, newSlope);
    }

    /// @dev only callable by governor
    function setPerYearInterestRateSlopeHigh(uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldSlope = configuratorParams.perYearInterestRateSlopeHigh;
        configuratorParams.perYearInterestRateSlopeHigh = newSlope;
        emit SetPerYearInterestRateSlopeHigh(oldSlope, newSlope);
    }

    /// @dev only callable by governor
    function setPerYearInterestRateBase(uint64 newBase) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBase = configuratorParams.perYearInterestRateBase;
        configuratorParams.perYearInterestRateBase = newBase;
        emit SetPerYearInterestRateBase(oldBase, newBase);
    }

    /// @dev only callable by governor
    function setReserveRate(uint64 newReserveRate) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldReserveRate = configuratorParams.reserveRate;
        configuratorParams.reserveRate = newReserveRate;
        emit SetReserveRate(oldReserveRate, newReserveRate);
    }

    /// @dev only callable by governor
    function setStoreFrontPriceFactor(uint64 newStoreFrontPriceFactor) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldStoreFrontPriceFactor = configuratorParams.storeFrontPriceFactor;
        configuratorParams.storeFrontPriceFactor = newStoreFrontPriceFactor;
        emit SetStoreFrontPriceFactor(oldStoreFrontPriceFactor, newStoreFrontPriceFactor);
    }

    /// @dev only callable by governor
    function setBaseTrackingSupplySpeed(uint64 newBaseTrackingSupplySpeed) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBaseTrackingSupplySpeed = configuratorParams.baseTrackingSupplySpeed;
        configuratorParams.baseTrackingSupplySpeed = newBaseTrackingSupplySpeed;
        emit SetBaseTrackingSupplySpeed(oldBaseTrackingSupplySpeed, newBaseTrackingSupplySpeed);
    }

    /// @dev only callable by governor
    function setBaseTrackingBorrowSpeed(uint64 newBaseTrackingBorrowSpeed) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBaseTrackingBorrowSpeed = configuratorParams.baseTrackingBorrowSpeed;
        configuratorParams.baseTrackingBorrowSpeed = newBaseTrackingBorrowSpeed;
        emit SetBaseTrackingBorrowSpeed(oldBaseTrackingBorrowSpeed, newBaseTrackingBorrowSpeed);
    }

    /// @dev only callable by governor
    function setBaseMinForRewards(uint104 newBaseMinForRewards) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldBaseMinForRewards = configuratorParams.baseMinForRewards;
        configuratorParams.baseMinForRewards = newBaseMinForRewards;
        emit SetBaseMinForRewards(oldBaseMinForRewards, newBaseMinForRewards);
    }

    /// @dev only callable by governor
    function setBaseBorrowMin(uint104 newBaseBorrowMin) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldBaseBorrowMin = configuratorParams.baseBorrowMin;
        configuratorParams.baseBorrowMin = newBaseBorrowMin;
        emit SetBaseBorrowMin(oldBaseBorrowMin, newBaseBorrowMin);
    }

    /// @dev only callable by governor
    function setTargetReserves(uint104 newTargetReserves) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldTargetReserves = configuratorParams.targetReserves;
        configuratorParams.targetReserves = newTargetReserves;
        emit SetTargetReserves(oldTargetReserves, newTargetReserves);
    }

    /// @dev only callable by governor
    function addAsset(AssetConfig calldata assetConfig) external {
        if (msg.sender != governor) revert Unauthorized();
        configuratorParams.packedAssetConfigs.push(getPackedAssetConfig(assetConfig));
        emit AddAsset(assetConfig);
    }

    /// @dev only callable by governor
    function updateAsset(AssetConfig calldata newAssetConfig) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(newAssetConfig.asset);
        AssetConfig memory oldAssetConfig = getUnpackedAssetConfig(configuratorParams.packedAssetConfigs[assetIndex]);
        configuratorParams.packedAssetConfigs[assetIndex] = getPackedAssetConfig(newAssetConfig);
        emit UpdateAsset(oldAssetConfig, newAssetConfig);
    }

    /// @dev only callable by governor
    function updateAssetPriceFeed(address asset, address newPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        AssetConfig memory oldAssetConfig = getUnpackedAssetConfig(configuratorParams.packedAssetConfigs[assetIndex]);
        AssetConfig memory newAssetConfig = oldAssetConfig;
        newAssetConfig.priceFeed = newPriceFeed;
        configuratorParams.packedAssetConfigs[assetIndex] = getPackedAssetConfig(newAssetConfig);
        emit UpdateAssetPriceFeed(asset, oldAssetConfig.priceFeed, newPriceFeed);
    }

    /// @dev only callable by governor
    function updateAssetBorrowCollateralFactor(address asset, uint64 newBorrowCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        AssetConfig memory oldAssetConfig = getUnpackedAssetConfig(configuratorParams.packedAssetConfigs[assetIndex]);
        AssetConfig memory newAssetConfig = oldAssetConfig;
        newAssetConfig.borrowCollateralFactor = newBorrowCF;
        configuratorParams.packedAssetConfigs[assetIndex] = getPackedAssetConfig(newAssetConfig);
        emit UpdateAssetBorrowCollateralFactor(asset, oldAssetConfig.borrowCollateralFactor, newBorrowCF);
    }

    /// @dev only callable by governor
    function updateAssetLiquidateCollateralFactor(address asset, uint64 newLiquidateCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        AssetConfig memory oldAssetConfig = getUnpackedAssetConfig(configuratorParams.packedAssetConfigs[assetIndex]);
        AssetConfig memory newAssetConfig = oldAssetConfig;
        newAssetConfig.liquidateCollateralFactor = newLiquidateCF;
        configuratorParams.packedAssetConfigs[assetIndex] = getPackedAssetConfig(newAssetConfig);
        emit UpdateAssetLiquidateCollateralFactor(asset, oldAssetConfig.liquidateCollateralFactor, newLiquidateCF);
    }

    /// @dev only callable by governor
    function updateAssetLiquidationFactor(address asset, uint64 newLiquidationFactor) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        AssetConfig memory oldAssetConfig = getUnpackedAssetConfig(configuratorParams.packedAssetConfigs[assetIndex]);
        AssetConfig memory newAssetConfig = oldAssetConfig;
        newAssetConfig.liquidationFactor = newLiquidationFactor;
        configuratorParams.packedAssetConfigs[assetIndex] = getPackedAssetConfig(newAssetConfig);
        emit UpdateAssetLiquidationFactor(asset, oldAssetConfig.liquidationFactor, newLiquidationFactor);
    }

    /// @dev only callable by governor
    function updateAssetSupplyCap(address asset, uint128 newSupplyCap) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        AssetConfig memory oldAssetConfig = getUnpackedAssetConfig(configuratorParams.packedAssetConfigs[assetIndex]);
        AssetConfig memory newAssetConfig = oldAssetConfig;
        newAssetConfig.supplyCap = newSupplyCap;
        configuratorParams.packedAssetConfigs[assetIndex] = getPackedAssetConfig(newAssetConfig);
        emit UpdateAssetSupplyCap(asset, oldAssetConfig.supplyCap, newSupplyCap);
    }

    /// @dev Determine index of asset that matches given address
    function getAssetIndex(address asset) internal view returns (uint) {
        PackedAssetConfig[] memory packedAssetConfigs = configuratorParams.packedAssetConfigs;
        uint numAssets = packedAssetConfigs.length;
        for (uint i = 0; i < numAssets; i++) {
            if (getUnpackedAssetConfig(packedAssetConfigs[i]).asset == asset) {
                return i;
            }
        }
        revert AssetDoesNotExist();
    }

    /** End of setters for Comet-related configuration **/

    /// @notice Gets the configuration params
    function getConfiguration() external view returns (Configuration memory) {
        return configuratorParams;
    }

    /// @notice Deploy a new version of the Comet implementation.
    /// @dev callable by anyone
    function deploy() external returns (address) {
        address newComet = CometFactory(factory).clone(configuratorParams);
        emit CometDeployed(newComet);
        return newComet;
    }

    /// @notice Transfers the governor rights to a new address
    /// @dev only callable by governor
    function transferGovernor(address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldGovernor = governor;
        governor = newGovernor;
        emit GovernorTransferred(oldGovernor, newGovernor);
    }

        /**
     * @dev Checks and gets the packed asset info for storage
     */
    function getPackedAssetConfig(AssetConfig memory assetConfig) internal view returns (PackedAssetConfig memory) {
        address asset = assetConfig.asset;
        address priceFeed = assetConfig.priceFeed;
        uint8 decimals = assetConfig.decimals;

        // Short-circuit if asset is nil
        if (asset == address(0)) {
            return PackedAssetConfig(0, 0);
        }

        // XXX Should we add back these checks?
        // Sanity check price feed and asset decimals
        // require(AggregatorV3Interface(priceFeed).decimals() == priceFeedDecimals, "bad price feed decimals");
        // require(ERC20(asset).decimals() == decimals, "asset decimals mismatch");

        // // Ensure collateral factors are within range
        // require(assetConfig.borrowCollateralFactor < assetConfig.liquidateCollateralFactor, "borrow CF must be < liquidate CF");
        // require(assetConfig.liquidateCollateralFactor <= maxCollateralFactor, "liquidate CF too high");

        // Keep 4 decimals for each factor
        // XXX Where to define FACTOR_SCALE and make sure it matches that of Comet?
        uint FACTOR_SCALE = 1e18;
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

        return PackedAssetConfig(word_a, word_b);
    }

    /**
     * @notice Get the i-th asset info, according to the order they were passed in originally
     * @param packedAssetConfig The packed asset config to unpack
     * @return The unpacked asset config object
     */
    function getUnpackedAssetConfig(PackedAssetConfig memory packedAssetConfig) internal view returns (AssetConfig memory) {
        uint256 word_a = packedAssetConfig.word_a;
        uint256 word_b = packedAssetConfig.word_b;

        // XXX Where to define FACTOR_SCALE and make sure it matches that of Comet?
        uint FACTOR_SCALE = 1e18;

        address asset = address(uint160(word_a & type(uint160).max));
        uint rescale = FACTOR_SCALE / 1e4;
        uint64 borrowCollateralFactor = uint64(((word_a >> 160) & type(uint16).max) * rescale);
        uint64 liquidateCollateralFactor = uint64(((word_a >> 176) & type(uint16).max) * rescale);
        uint64 liquidationFactor = uint64(((word_a >> 192) & type(uint16).max) * rescale);

        address priceFeed = address(uint160(word_b & type(uint160).max));
        uint8 decimals_ = uint8(((word_b >> 160) & type(uint8).max));
        uint64 scale = uint64(10 ** decimals_);
        uint128 supplyCap = uint128(((word_b >> 168) & type(uint64).max) * scale);

        return AssetConfig({
            asset: asset,
            priceFeed: priceFeed,
            decimals: decimals_,
            borrowCollateralFactor: borrowCollateralFactor,
            liquidateCollateralFactor: liquidateCollateralFactor,
            liquidationFactor: liquidationFactor,
            supplyCap: supplyCap
         });
    }
}
