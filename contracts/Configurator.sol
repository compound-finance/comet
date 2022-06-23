// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./ConfiguratorStorage.sol";

contract Configurator is ConfiguratorStorage {

    /** Custom events **/

    event AddAsset(AssetConfig assetConfig);
    event CometDeployed(address indexed newComet);
    event GovernorTransferred(address indexed oldGovernor, address indexed newGovernor);
    event SetFactory(address indexed oldFactory, address indexed newFactory);
    event SetGovernor(address indexed oldGovernor, address indexed newGovernor);
    event SetPauseGuardian(address indexed oldPauseGuardian, address indexed newPauseGuardian);
    event SetBaseTokenPriceFeed(address indexed oldBaseTokenPriceFeed, address indexed newBaseTokenPriceFeed);
    event SetExtensionDelegate(address indexed oldExt, address indexed newExt);
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

    /// @notice Constructs a new Configurator instance
    constructor() {
        // Set a high version to prevent the implementation contract from being initialized
        version = type(uint256).max;
    }

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
        configuratorParams.assetConfigs.push(assetConfig);
        emit AddAsset(assetConfig);
    }

    /// @dev only callable by governor
    function updateAsset(AssetConfig calldata newAssetConfig) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(newAssetConfig.asset);
        AssetConfig memory oldAssetConfig = configuratorParams.assetConfigs[assetIndex];
        configuratorParams.assetConfigs[assetIndex] = newAssetConfig;
        emit UpdateAsset(oldAssetConfig, newAssetConfig);
    }

    /// @dev only callable by governor
    function updateAssetPriceFeed(address asset, address newPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        address oldPriceFeed = configuratorParams.assetConfigs[assetIndex].priceFeed;
        configuratorParams.assetConfigs[assetIndex].priceFeed = newPriceFeed;
        emit UpdateAssetPriceFeed(asset, oldPriceFeed, newPriceFeed);
    }

    /// @dev only callable by governor
    function updateAssetBorrowCollateralFactor(address asset, uint64 newBorrowCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        uint64 oldBorrowCF = configuratorParams.assetConfigs[assetIndex].borrowCollateralFactor;
        configuratorParams.assetConfigs[assetIndex].borrowCollateralFactor = newBorrowCF;
        emit UpdateAssetBorrowCollateralFactor(asset, oldBorrowCF, newBorrowCF);
    }

    /// @dev only callable by governor
    function updateAssetLiquidateCollateralFactor(address asset, uint64 newLiquidateCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        uint64 oldLiquidateCF = configuratorParams.assetConfigs[assetIndex].liquidateCollateralFactor;
        configuratorParams.assetConfigs[assetIndex].liquidateCollateralFactor = newLiquidateCF;
        emit UpdateAssetLiquidateCollateralFactor(asset, oldLiquidateCF, newLiquidateCF);
    }

    /// @dev only callable by governor
    function updateAssetLiquidationFactor(address asset, uint64 newLiquidationFactor) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        uint64 oldLiquidationFactor = configuratorParams.assetConfigs[assetIndex].liquidationFactor;
        configuratorParams.assetConfigs[assetIndex].liquidationFactor = newLiquidationFactor;
        emit UpdateAssetLiquidationFactor(asset, oldLiquidationFactor, newLiquidationFactor);
    }

    /// @dev only callable by governor
    function updateAssetSupplyCap(address asset, uint128 newSupplyCap) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        uint128 oldSupplyCap = configuratorParams.assetConfigs[assetIndex].supplyCap;
        configuratorParams.assetConfigs[assetIndex].supplyCap = newSupplyCap;
        emit UpdateAssetSupplyCap(asset, oldSupplyCap, newSupplyCap);
    }

    /// @dev Determine index of asset that matches given address
    function getAssetIndex(address asset) internal view returns (uint) {
        AssetConfig[] memory assetConfigs = configuratorParams.assetConfigs;
        uint numAssets = assetConfigs.length;
        for (uint i = 0; i < numAssets; ) {
            if (assetConfigs[i].asset == asset) {
                return i;
            }
            unchecked { i++; }
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
}
