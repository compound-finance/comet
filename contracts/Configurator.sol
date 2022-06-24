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

    /**
     * @notice Constructs a new Configurator instance
     **/
    constructor() {
        // Set a high version to prevent the implementation contract from being initialized
        version = type(uint256).max;
    }

    /**
     * @notice Initializes the storage for Configurator
     * @dev Note: All params can be updated by the governor except for `baseToken` and `trackingIndexScale`
     * @param governor_ The address of the governor
     * @param cometProxy_ The address of the Comet proxy to store the factory and configuration for
     * @param factory_ The address of the Comet factory
     * @param configuratorParams_ Config passed to new instances of Comet on construction
     **/
    function initialize(address governor_, address cometProxy_, address factory_, Configuration calldata configuratorParams_) public {
        if (version != 0) revert AlreadyInitialized();
        if (governor_ == address(0)) revert InvalidAddress();
        if (cometProxy_ == address(0)) revert InvalidAddress();
        if (factory_ == address(0)) revert InvalidAddress();

        governor = governor_;
        factory[cometProxy_] = factory_;
        configuratorParams[cometProxy_] = configuratorParams_;
        version = 1;
    }

    /**
     * @notice Sets the factory for Configurator
     * @dev Note: Only callable by governor
     **/
    function setFactory(address cometProxy, address newFactory) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldFactory = factory[cometProxy];
        factory[cometProxy] = newFactory;
        emit SetFactory(oldFactory, newFactory);
    }

    /** Governance setters for Comet-related configuration **/

    function setGovernor(address cometProxy, address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldGovernor = configuratorParams[cometProxy].governor;
        configuratorParams[cometProxy].governor = newGovernor;
        emit SetGovernor(oldGovernor, newGovernor);
    }

    function setPauseGuardian(address cometProxy, address newPauseGuardian) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldPauseGuardian = configuratorParams[cometProxy].pauseGuardian;
        configuratorParams[cometProxy].pauseGuardian = newPauseGuardian;
        emit SetPauseGuardian(oldPauseGuardian, newPauseGuardian);
    }

    function setBaseTokenPriceFeed(address cometProxy, address newBaseTokenPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldBaseTokenPriceFeed = configuratorParams[cometProxy].baseTokenPriceFeed;
        configuratorParams[cometProxy].baseTokenPriceFeed = newBaseTokenPriceFeed;
        emit SetBaseTokenPriceFeed(oldBaseTokenPriceFeed, newBaseTokenPriceFeed);
    }

    function setExtensionDelegate(address cometProxy, address newExtensionDelegate) external {
        if (msg.sender != governor) revert Unauthorized();

        address oldExtensionDelegate = configuratorParams[cometProxy].extensionDelegate;
        configuratorParams[cometProxy].extensionDelegate = newExtensionDelegate;
        emit SetExtensionDelegate(oldExtensionDelegate, newExtensionDelegate);
    }

    function setKink(address cometProxy, uint64 newKink) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldKink = configuratorParams[cometProxy].kink;
        configuratorParams[cometProxy].kink = newKink;
        emit SetKink(oldKink, newKink);
    }

    function setPerYearInterestRateSlopeLow(address cometProxy, uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldSlope = configuratorParams[cometProxy].perYearInterestRateSlopeLow;
        configuratorParams[cometProxy].perYearInterestRateSlopeLow = newSlope;
        emit SetPerYearInterestRateSlopeLow(oldSlope, newSlope);
    }

    function setPerYearInterestRateSlopeHigh(address cometProxy, uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldSlope = configuratorParams[cometProxy].perYearInterestRateSlopeHigh;
        configuratorParams[cometProxy].perYearInterestRateSlopeHigh = newSlope;
        emit SetPerYearInterestRateSlopeHigh(oldSlope, newSlope);
    }

    function setPerYearInterestRateBase(address cometProxy, uint64 newBase) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldBase = configuratorParams[cometProxy].perYearInterestRateBase;
        configuratorParams[cometProxy].perYearInterestRateBase = newBase;
        emit SetPerYearInterestRateBase(oldBase, newBase);
    }

    function setReserveRate(address cometProxy, uint64 newReserveRate) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldReserveRate = configuratorParams[cometProxy].reserveRate;
        configuratorParams[cometProxy].reserveRate = newReserveRate;
        emit SetReserveRate(oldReserveRate, newReserveRate);
    }

    function setStoreFrontPriceFactor(address cometProxy, uint64 newStoreFrontPriceFactor) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldStoreFrontPriceFactor = configuratorParams[cometProxy].storeFrontPriceFactor;
        configuratorParams[cometProxy].storeFrontPriceFactor = newStoreFrontPriceFactor;
        emit SetStoreFrontPriceFactor(oldStoreFrontPriceFactor, newStoreFrontPriceFactor);
    }

    function setBaseTrackingSupplySpeed(address cometProxy, uint64 newBaseTrackingSupplySpeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldBaseTrackingSupplySpeed = configuratorParams[cometProxy].baseTrackingSupplySpeed;
        configuratorParams[cometProxy].baseTrackingSupplySpeed = newBaseTrackingSupplySpeed;
        emit SetBaseTrackingSupplySpeed(oldBaseTrackingSupplySpeed, newBaseTrackingSupplySpeed);
    }

    function setBaseTrackingBorrowSpeed(address cometProxy, uint64 newBaseTrackingBorrowSpeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint64 oldBaseTrackingBorrowSpeed = configuratorParams[cometProxy].baseTrackingBorrowSpeed;
        configuratorParams[cometProxy].baseTrackingBorrowSpeed = newBaseTrackingBorrowSpeed;
        emit SetBaseTrackingBorrowSpeed(oldBaseTrackingBorrowSpeed, newBaseTrackingBorrowSpeed);
    }

    function setBaseMinForRewards(address cometProxy, uint104 newBaseMinForRewards) external {
        if (msg.sender != governor) revert Unauthorized();

        uint104 oldBaseMinForRewards = configuratorParams[cometProxy].baseMinForRewards;
        configuratorParams[cometProxy].baseMinForRewards = newBaseMinForRewards;
        emit SetBaseMinForRewards(oldBaseMinForRewards, newBaseMinForRewards);
    }

    function setBaseBorrowMin(address cometProxy, uint104 newBaseBorrowMin) external {
        if (msg.sender != governor) revert Unauthorized();

        uint104 oldBaseBorrowMin = configuratorParams[cometProxy].baseBorrowMin;
        configuratorParams[cometProxy].baseBorrowMin = newBaseBorrowMin;
        emit SetBaseBorrowMin(oldBaseBorrowMin, newBaseBorrowMin);
    }

    function setTargetReserves(address cometProxy, uint104 newTargetReserves) external {
        if (msg.sender != governor) revert Unauthorized();

        uint104 oldTargetReserves = configuratorParams[cometProxy].targetReserves;
        configuratorParams[cometProxy].targetReserves = newTargetReserves;
        emit SetTargetReserves(oldTargetReserves, newTargetReserves);
    }

    function addAsset(address cometProxy, AssetConfig calldata assetConfig) external {
        if (msg.sender != governor) revert Unauthorized();

        configuratorParams[cometProxy].assetConfigs.push(assetConfig);
        emit AddAsset(assetConfig);
    }

    function updateAsset(address cometProxy, AssetConfig calldata newAssetConfig) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, newAssetConfig.asset);
        AssetConfig memory oldAssetConfig = configuratorParams[cometProxy].assetConfigs[assetIndex];
        configuratorParams[cometProxy].assetConfigs[assetIndex] = newAssetConfig;
        emit UpdateAsset(oldAssetConfig, newAssetConfig);
    }

    function updateAssetPriceFeed(address cometProxy, address asset, address newPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        address oldPriceFeed = configuratorParams[cometProxy].assetConfigs[assetIndex].priceFeed;
        configuratorParams[cometProxy].assetConfigs[assetIndex].priceFeed = newPriceFeed;
        emit UpdateAssetPriceFeed(asset, oldPriceFeed, newPriceFeed);
    }

    function updateAssetBorrowCollateralFactor(address cometProxy, address asset, uint64 newBorrowCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        uint64 oldBorrowCF = configuratorParams[cometProxy].assetConfigs[assetIndex].borrowCollateralFactor;
        configuratorParams[cometProxy].assetConfigs[assetIndex].borrowCollateralFactor = newBorrowCF;
        emit UpdateAssetBorrowCollateralFactor(asset, oldBorrowCF, newBorrowCF);
    }

    function updateAssetLiquidateCollateralFactor(address cometProxy, address asset, uint64 newLiquidateCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        uint64 oldLiquidateCF = configuratorParams[cometProxy].assetConfigs[assetIndex].liquidateCollateralFactor;
        configuratorParams[cometProxy].assetConfigs[assetIndex].liquidateCollateralFactor = newLiquidateCF;
        emit UpdateAssetLiquidateCollateralFactor(asset, oldLiquidateCF, newLiquidateCF);
    }

    function updateAssetLiquidationFactor(address cometProxy, address asset, uint64 newLiquidationFactor) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        uint64 oldLiquidationFactor = configuratorParams[cometProxy].assetConfigs[assetIndex].liquidationFactor;
        configuratorParams[cometProxy].assetConfigs[assetIndex].liquidationFactor = newLiquidationFactor;
        emit UpdateAssetLiquidationFactor(asset, oldLiquidationFactor, newLiquidationFactor);
    }

    function updateAssetSupplyCap(address cometProxy, address asset, uint128 newSupplyCap) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(cometProxy, asset);
        uint128 oldSupplyCap = configuratorParams[cometProxy].assetConfigs[assetIndex].supplyCap;
        configuratorParams[cometProxy].assetConfigs[assetIndex].supplyCap = newSupplyCap;
        emit UpdateAssetSupplyCap(asset, oldSupplyCap, newSupplyCap);
    }

    /** Other helpers **/

    /**
     * @dev Determine index of asset that matches given address
     */
    function getAssetIndex(address cometProxy, address asset) internal view returns (uint) {
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
        emit CometDeployed(newComet);
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
