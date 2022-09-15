// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./ConfiguratorStorage.sol";

contract Configurator is ConfiguratorStorage {

    /** Custom events **/

    event AddAsset(address indexed cometProxy, AssetConfig assetConfig);
    event CometDeployed(address indexed cometProxy, address indexed newComet);
    event GovernorTransferred(address indexed oldGovernor, address indexed newGovernor);
    event SetFactory(address indexed cometProxy, address indexed oldFactory, address indexed newFactory);
    event SetGovernor(address indexed cometProxy, address indexed oldGovernor, address indexed newGovernor);
    event SetConfiguration(address indexed cometProxy, Configuration oldConfiguration, Configuration newConfiguration);
    event SetPauseGuardian(address indexed cometProxy, address indexed oldPauseGuardian, address indexed newPauseGuardian);
    event SetBaseTokenPriceFeed(address indexed cometProxy, address indexed oldBaseTokenPriceFeed, address indexed newBaseTokenPriceFeed);
    event SetExtensionDelegate(address indexed cometProxy, address indexed oldExt, address indexed newExt);
    event SetSupplyKink(address indexed cometProxy,uint64 oldKink, uint64 newKink);
    event SetSupplyPerYearInterestRateSlopeLow(address indexed cometProxy,uint64 oldIRSlopeLow, uint64 newIRSlopeLow);
    event SetSupplyPerYearInterestRateSlopeHigh(address indexed cometProxy,uint64 oldIRSlopeHigh, uint64 newIRSlopeHigh);
    event SetSupplyPerYearInterestRateBase(address indexed cometProxy,uint64 oldIRBase, uint64 newIRBase);
    event SetBorrowKink(address indexed cometProxy,uint64 oldKink, uint64 newKink);
    event SetBorrowPerYearInterestRateSlopeLow(address indexed cometProxy,uint64 oldIRSlopeLow, uint64 newIRSlopeLow);
    event SetBorrowPerYearInterestRateSlopeHigh(address indexed cometProxy,uint64 oldIRSlopeHigh, uint64 newIRSlopeHigh);
    event SetBorrowPerYearInterestRateBase(address indexed cometProxy,uint64 oldIRBase, uint64 newIRBase);
    event SetStoreFrontPriceFactor(address indexed cometProxy, uint64 oldStoreFrontPriceFactor, uint64 newStoreFrontPriceFactor);
    event SetBaseTrackingSupplySpeed(address indexed cometProxy, uint64 oldBaseTrackingSupplySpeed, uint64 newBaseTrackingSupplySpeed);
    event SetBaseTrackingBorrowSpeed(address indexed cometProxy, uint64 oldBaseTrackingBorrowSpeed, uint64 newBaseTrackingBorrowSpeed);
    event SetBaseMinForRewards(address indexed cometProxy, uint104 oldBaseMinForRewards, uint104 newBaseMinForRewards);
    event SetBaseBorrowMin(address indexed cometProxy, uint104 oldBaseBorrowMin, uint104 newBaseBorrowMin);
    event SetTargetReserves(address indexed cometProxy, uint104 oldTargetReserves, uint104 newTargetReserves);
    event UpdateAsset(address indexed cometProxy, AssetConfig oldAssetConfig, AssetConfig newAssetConfig);
    event UpdateAssetPriceFeed(address indexed cometProxy, address indexed asset, address oldPriceFeed, address newPriceFeed);
    event UpdateAssetBorrowCollateralFactor(address indexed cometProxy, address indexed asset, uint64 oldBorrowCF, uint64 newBorrowCF);
    event UpdateAssetLiquidateCollateralFactor(address indexed cometProxy, address indexed asset, uint64 oldLiquidateCF, uint64 newLiquidateCF);
    event UpdateAssetLiquidationFactor(address indexed cometProxy, address indexed asset, uint64 oldLiquidationFactor, uint64 newLiquidationFactor);
    event UpdateAssetSupplyCap(address indexed cometProxy, address indexed asset, uint128 oldSupplyCap, uint128 newSupplyCap);

    /** Custom errors **/

    error AlreadyInitialized();
    error AssetDoesNotExist();
    error ConfigurationAlreadyExists();
    error InvalidAddress();
    error Unauthorized();

    /**
     * @notice Constructs a new Configurator instance
     **/
    constructor() {
        // Set a high version to prevent the implementation contract from being initialized
        version = type(uint256).max;
    }

    /**
     * @notice Initializes the storage for Configurator
     * @param governor_ The address of the governor
     **/
    function initialize(address governor_) public {
        if (version != 0) revert AlreadyInitialized();
        if (governor_ == address(0)) revert InvalidAddress();

        governor = governor_;
        version = 1;
    }

    /**
     * @notice Sets the factory for a Comet proxy
     * @dev Note: Only callable by governor
     **/
    function setFactory(address cometProxy, address newFactory) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldFactory = factory[cometProxy];
        factory[cometProxy] = newFactory;
        emit SetFactory(cometProxy, oldFactory, newFactory);
    }

    /**
     * @notice Sets the entire Configuration for a Comet proxy
     * @dev Note: All params can later be updated by the governor except for `baseToken` and `trackingIndexScale`
     **/
    function setConfiguration(address cometProxy, Configuration calldata newConfiguration) external {
        if (msg.sender != governor) revert Unauthorized();
        Configuration memory oldConfiguration = configuratorParams[cometProxy];
        if (oldConfiguration.baseToken != address(0) &&
            (oldConfiguration.baseToken != newConfiguration.baseToken ||
             oldConfiguration.trackingIndexScale != newConfiguration.trackingIndexScale))
            revert ConfigurationAlreadyExists();

        configuratorParams[cometProxy] = newConfiguration;
        emit SetConfiguration(cometProxy, oldConfiguration, newConfiguration);
    }

    /** Governance setters for Comet-related configuration **/

    function setGovernor(address cometProxy, address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldGovernor = configuratorParams[cometProxy].governor;
        configuratorParams[cometProxy].governor = newGovernor;
        emit SetGovernor(cometProxy, oldGovernor, newGovernor);
    }

    function setPauseGuardian(address cometProxy, address newPauseGuardian) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldPauseGuardian = configuratorParams[cometProxy].pauseGuardian;
        configuratorParams[cometProxy].pauseGuardian = newPauseGuardian;
        emit SetPauseGuardian(cometProxy, oldPauseGuardian, newPauseGuardian);
    }

    function setBaseTokenPriceFeed(address cometProxy, address newBaseTokenPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldBaseTokenPriceFeed = configuratorParams[cometProxy].baseTokenPriceFeed;
        configuratorParams[cometProxy].baseTokenPriceFeed = newBaseTokenPriceFeed;
        emit SetBaseTokenPriceFeed(cometProxy, oldBaseTokenPriceFeed, newBaseTokenPriceFeed);
    }

    function setExtensionDelegate(address cometProxy, address newExtensionDelegate) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldExtensionDelegate = configuratorParams[cometProxy].extensionDelegate;
        configuratorParams[cometProxy].extensionDelegate = newExtensionDelegate;
        emit SetExtensionDelegate(cometProxy, oldExtensionDelegate, newExtensionDelegate);
    }

    function setSupplyKink(address cometProxy, uint64 newSupplyKink) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldSupplyKink = configuratorParams[cometProxy].supplyKink;
        configuratorParams[cometProxy].supplyKink = newSupplyKink;
        emit SetSupplyKink(cometProxy, oldSupplyKink, newSupplyKink);
    }

    function setSupplyPerYearInterestRateSlopeLow(address cometProxy, uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldSlope = configuratorParams[cometProxy].supplyPerYearInterestRateSlopeLow;
        configuratorParams[cometProxy].supplyPerYearInterestRateSlopeLow = newSlope;
        emit SetSupplyPerYearInterestRateSlopeLow(cometProxy, oldSlope, newSlope);
    }

    function setSupplyPerYearInterestRateSlopeHigh(address cometProxy, uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldSlope = configuratorParams[cometProxy].supplyPerYearInterestRateSlopeHigh;
        configuratorParams[cometProxy].supplyPerYearInterestRateSlopeHigh = newSlope;
        emit SetSupplyPerYearInterestRateSlopeHigh(cometProxy, oldSlope, newSlope);
    }

    function setSupplyPerYearInterestRateBase(address cometProxy, uint64 newBase) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldBase = configuratorParams[cometProxy].supplyPerYearInterestRateBase;
        configuratorParams[cometProxy].supplyPerYearInterestRateBase = newBase;
        emit SetSupplyPerYearInterestRateBase(cometProxy, oldBase, newBase);
    }

    function setBorrowKink(address cometProxy, uint64 newBorrowKink) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldBorrowKink = configuratorParams[cometProxy].borrowKink;
        configuratorParams[cometProxy].borrowKink = newBorrowKink;
        emit SetBorrowKink(cometProxy, oldBorrowKink, newBorrowKink);
    }

    function setBorrowPerYearInterestRateSlopeLow(address cometProxy, uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldSlope = configuratorParams[cometProxy].borrowPerYearInterestRateSlopeLow;
        configuratorParams[cometProxy].borrowPerYearInterestRateSlopeLow = newSlope;
        emit SetBorrowPerYearInterestRateSlopeLow(cometProxy, oldSlope, newSlope);
    }

    function setBorrowPerYearInterestRateSlopeHigh(address cometProxy, uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldSlope = configuratorParams[cometProxy].borrowPerYearInterestRateSlopeHigh;
        configuratorParams[cometProxy].borrowPerYearInterestRateSlopeHigh = newSlope;
        emit SetBorrowPerYearInterestRateSlopeHigh(cometProxy, oldSlope, newSlope);
    }

    function setBorrowPerYearInterestRateBase(address cometProxy, uint64 newBase) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldBase = configuratorParams[cometProxy].borrowPerYearInterestRateBase;
        configuratorParams[cometProxy].borrowPerYearInterestRateBase = newBase;
        emit SetBorrowPerYearInterestRateBase(cometProxy, oldBase, newBase);
    }

    function setStoreFrontPriceFactor(address cometProxy, uint64 newStoreFrontPriceFactor) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldStoreFrontPriceFactor = configuratorParams[cometProxy].storeFrontPriceFactor;
        configuratorParams[cometProxy].storeFrontPriceFactor = newStoreFrontPriceFactor;
        emit SetStoreFrontPriceFactor(cometProxy, oldStoreFrontPriceFactor, newStoreFrontPriceFactor);
    }

    function setBaseTrackingSupplySpeed(address cometProxy, uint64 newBaseTrackingSupplySpeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldBaseTrackingSupplySpeed = configuratorParams[cometProxy].baseTrackingSupplySpeed;
        configuratorParams[cometProxy].baseTrackingSupplySpeed = newBaseTrackingSupplySpeed;
        emit SetBaseTrackingSupplySpeed(cometProxy, oldBaseTrackingSupplySpeed, newBaseTrackingSupplySpeed);
    }

    function setBaseTrackingBorrowSpeed(address cometProxy, uint64 newBaseTrackingBorrowSpeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldBaseTrackingBorrowSpeed = configuratorParams[cometProxy].baseTrackingBorrowSpeed;
        configuratorParams[cometProxy].baseTrackingBorrowSpeed = newBaseTrackingBorrowSpeed;
        emit SetBaseTrackingBorrowSpeed(cometProxy, oldBaseTrackingBorrowSpeed, newBaseTrackingBorrowSpeed);
    }

    function setBaseMinForRewards(address cometProxy, uint104 newBaseMinForRewards) external {
        if (msg.sender != governor) revert Unauthorized();

        uint104 oldBaseMinForRewards = configuratorParams[cometProxy].baseMinForRewards;
        configuratorParams[cometProxy].baseMinForRewards = newBaseMinForRewards;
        emit SetBaseMinForRewards(cometProxy, oldBaseMinForRewards, newBaseMinForRewards);
    }

    function setBaseBorrowMin(address cometProxy, uint104 newBaseBorrowMin) external {
        if (msg.sender != governor) revert Unauthorized();

        uint104 oldBaseBorrowMin = configuratorParams[cometProxy].baseBorrowMin;
        configuratorParams[cometProxy].baseBorrowMin = newBaseBorrowMin;
        emit SetBaseBorrowMin(cometProxy, oldBaseBorrowMin, newBaseBorrowMin);
    }

    function setTargetReserves(address cometProxy, uint104 newTargetReserves) external {
        if (msg.sender != governor) revert Unauthorized();

        uint104 oldTargetReserves = configuratorParams[cometProxy].targetReserves;
        configuratorParams[cometProxy].targetReserves = newTargetReserves;
        emit SetTargetReserves(cometProxy, oldTargetReserves, newTargetReserves);
    }

    function addAsset(address cometProxy, AssetConfig calldata assetConfig) external {
        if (msg.sender != governor) revert Unauthorized();

        configuratorParams[cometProxy].assetConfigs.push(assetConfig);
        emit AddAsset(cometProxy, assetConfig);
    }

    function updateAsset(address cometProxy, AssetConfig calldata newAssetConfig) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, newAssetConfig.asset);
        AssetConfig memory oldAssetConfig = configuratorParams[cometProxy].assetConfigs[assetIndex];
        configuratorParams[cometProxy].assetConfigs[assetIndex] = newAssetConfig;
        emit UpdateAsset(cometProxy, oldAssetConfig, newAssetConfig);
    }

    function updateAssetPriceFeed(address cometProxy, address asset, address newPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        address oldPriceFeed = configuratorParams[cometProxy].assetConfigs[assetIndex].priceFeed;
        configuratorParams[cometProxy].assetConfigs[assetIndex].priceFeed = newPriceFeed;
        emit UpdateAssetPriceFeed(cometProxy, asset, oldPriceFeed, newPriceFeed);
    }

    function updateAssetBorrowCollateralFactor(address cometProxy, address asset, uint64 newBorrowCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        uint64 oldBorrowCF = configuratorParams[cometProxy].assetConfigs[assetIndex].borrowCollateralFactor;
        configuratorParams[cometProxy].assetConfigs[assetIndex].borrowCollateralFactor = newBorrowCF;
        emit UpdateAssetBorrowCollateralFactor(cometProxy, asset, oldBorrowCF, newBorrowCF);
    }

    function updateAssetLiquidateCollateralFactor(address cometProxy, address asset, uint64 newLiquidateCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        uint64 oldLiquidateCF = configuratorParams[cometProxy].assetConfigs[assetIndex].liquidateCollateralFactor;
        configuratorParams[cometProxy].assetConfigs[assetIndex].liquidateCollateralFactor = newLiquidateCF;
        emit UpdateAssetLiquidateCollateralFactor(cometProxy, asset, oldLiquidateCF, newLiquidateCF);
    }

    function updateAssetLiquidationFactor(address cometProxy, address asset, uint64 newLiquidationFactor) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        uint64 oldLiquidationFactor = configuratorParams[cometProxy].assetConfigs[assetIndex].liquidationFactor;
        configuratorParams[cometProxy].assetConfigs[assetIndex].liquidationFactor = newLiquidationFactor;
        emit UpdateAssetLiquidationFactor(cometProxy, asset, oldLiquidationFactor, newLiquidationFactor);
    }

    function updateAssetSupplyCap(address cometProxy, address asset, uint128 newSupplyCap) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        uint128 oldSupplyCap = configuratorParams[cometProxy].assetConfigs[assetIndex].supplyCap;
        configuratorParams[cometProxy].assetConfigs[assetIndex].supplyCap = newSupplyCap;
        emit UpdateAssetSupplyCap(cometProxy, asset, oldSupplyCap, newSupplyCap);
    }

    /** Other helpers **/

    /**
     * @dev Determine index of asset that matches given address
     */
    function getAssetIndex(address cometProxy, address asset) public view returns (uint) {
        AssetConfig[] memory assetConfigs = configuratorParams[cometProxy].assetConfigs;
        uint numAssets = assetConfigs.length;
        for (uint i = 0; i < numAssets; ) {
            if (assetConfigs[i].asset == asset) {
                return i;
            }
            unchecked { i++; }
        }
        revert AssetDoesNotExist();
    }

    /**
     * @return The currently configured params for a Comet proxy
     **/
    function getConfiguration(address cometProxy) external view returns (Configuration memory) {
        return configuratorParams[cometProxy];
    }

    /**
     * @notice Deploy a new Comet implementation using the factory and Configuration for that Comet proxy
     * @dev Note: Callable by anyone
     */
    function deploy(address cometProxy) external returns (address) {
        address newComet = CometFactory(factory[cometProxy]).clone(configuratorParams[cometProxy]);
        emit CometDeployed(cometProxy, newComet);
        return newComet;
    }

    /**
     * @notice Transfers the governor rights to a new address
     */
    function transferGovernor(address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldGovernor = governor;
        governor = newGovernor;
        emit GovernorTransferred(oldGovernor, newGovernor);
    }
}
