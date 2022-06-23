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
     * @dev Note: All params can be updated by the governor except `baseToken` and `trackingIndexScale`
     * @param governor_ The address of the governor
     * @param factory_ The address of the Comet factory
     * @param configuratorParams_ Config passed to new instances of Comet on construction
     **/
    function initialize(address governor_, address factory_, Configuration calldata configuratorParams_) public {
        if (version != 0) revert AlreadyInitialized();
        if (governor_ == address(0)) revert InvalidAddress();
        if (factory_ == address(0)) revert InvalidAddress();

        governor = governor_;
        factory = factory_;
        configuratorParams = configuratorParams_;
        version = 1;
    }

    /**
     * @notice Sets the factory for Configurator
     * @dev Note: Only callable by governor
     **/
    function setFactory(address newFactory) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldFactory = factory;
        factory = newFactory;
        emit SetFactory(oldFactory, newFactory);
    }

    /** Governance setters for Comet-related configuration **/

    function setGovernor(address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldGovernor = configuratorParams.governor;
        configuratorParams.governor = newGovernor;
        emit SetGovernor(oldGovernor, newGovernor);
    }

    function setPauseGuardian(address newPauseGuardian) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldPauseGuardian = configuratorParams.pauseGuardian;
        configuratorParams.pauseGuardian = newPauseGuardian;
        emit SetPauseGuardian(oldPauseGuardian, newPauseGuardian);
    }

    function setBaseTokenPriceFeed(address newBaseTokenPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldBaseTokenPriceFeed = configuratorParams.baseTokenPriceFeed;
        configuratorParams.baseTokenPriceFeed = newBaseTokenPriceFeed;
        emit SetBaseTokenPriceFeed(oldBaseTokenPriceFeed, newBaseTokenPriceFeed);
    }

    function setExtensionDelegate(address newExtensionDelegate) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldExtensionDelegate = configuratorParams.extensionDelegate;
        configuratorParams.extensionDelegate = newExtensionDelegate;
        emit SetExtensionDelegate(oldExtensionDelegate, newExtensionDelegate);
    }

    function setKink(uint64 newKink) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldKink = configuratorParams.kink;
        configuratorParams.kink = newKink;
        emit SetKink(oldKink, newKink);
    }

    function setPerYearInterestRateSlopeLow(uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldSlope = configuratorParams.perYearInterestRateSlopeLow;
        configuratorParams.perYearInterestRateSlopeLow = newSlope;
        emit SetPerYearInterestRateSlopeLow(oldSlope, newSlope);
    }

    function setPerYearInterestRateSlopeHigh(uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldSlope = configuratorParams.perYearInterestRateSlopeHigh;
        configuratorParams.perYearInterestRateSlopeHigh = newSlope;
        emit SetPerYearInterestRateSlopeHigh(oldSlope, newSlope);
    }

    function setPerYearInterestRateBase(uint64 newBase) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBase = configuratorParams.perYearInterestRateBase;
        configuratorParams.perYearInterestRateBase = newBase;
        emit SetPerYearInterestRateBase(oldBase, newBase);
    }

    function setReserveRate(uint64 newReserveRate) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldReserveRate = configuratorParams.reserveRate;
        configuratorParams.reserveRate = newReserveRate;
        emit SetReserveRate(oldReserveRate, newReserveRate);
    }

    function setStoreFrontPriceFactor(uint64 newStoreFrontPriceFactor) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldStoreFrontPriceFactor = configuratorParams.storeFrontPriceFactor;
        configuratorParams.storeFrontPriceFactor = newStoreFrontPriceFactor;
        emit SetStoreFrontPriceFactor(oldStoreFrontPriceFactor, newStoreFrontPriceFactor);
    }

    function setBaseTrackingSupplySpeed(uint64 newBaseTrackingSupplySpeed) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBaseTrackingSupplySpeed = configuratorParams.baseTrackingSupplySpeed;
        configuratorParams.baseTrackingSupplySpeed = newBaseTrackingSupplySpeed;
        emit SetBaseTrackingSupplySpeed(oldBaseTrackingSupplySpeed, newBaseTrackingSupplySpeed);
    }

    function setBaseTrackingBorrowSpeed(uint64 newBaseTrackingBorrowSpeed) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBaseTrackingBorrowSpeed = configuratorParams.baseTrackingBorrowSpeed;
        configuratorParams.baseTrackingBorrowSpeed = newBaseTrackingBorrowSpeed;
        emit SetBaseTrackingBorrowSpeed(oldBaseTrackingBorrowSpeed, newBaseTrackingBorrowSpeed);
    }

    function setBaseMinForRewards(uint104 newBaseMinForRewards) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldBaseMinForRewards = configuratorParams.baseMinForRewards;
        configuratorParams.baseMinForRewards = newBaseMinForRewards;
        emit SetBaseMinForRewards(oldBaseMinForRewards, newBaseMinForRewards);
    }

    function setBaseBorrowMin(uint104 newBaseBorrowMin) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldBaseBorrowMin = configuratorParams.baseBorrowMin;
        configuratorParams.baseBorrowMin = newBaseBorrowMin;
        emit SetBaseBorrowMin(oldBaseBorrowMin, newBaseBorrowMin);
    }

    function setTargetReserves(uint104 newTargetReserves) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldTargetReserves = configuratorParams.targetReserves;
        configuratorParams.targetReserves = newTargetReserves;
        emit SetTargetReserves(oldTargetReserves, newTargetReserves);
    }

    function addAsset(AssetConfig calldata assetConfig) external {
        if (msg.sender != governor) revert Unauthorized();
        configuratorParams.assetConfigs.push(assetConfig);
        emit AddAsset(assetConfig);
    }

    function updateAsset(AssetConfig calldata newAssetConfig) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(newAssetConfig.asset);
        AssetConfig memory oldAssetConfig = configuratorParams.assetConfigs[assetIndex];
        configuratorParams.assetConfigs[assetIndex] = newAssetConfig;
        emit UpdateAsset(oldAssetConfig, newAssetConfig);
    }

    function updateAssetPriceFeed(address asset, address newPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        address oldPriceFeed = configuratorParams.assetConfigs[assetIndex].priceFeed;
        configuratorParams.assetConfigs[assetIndex].priceFeed = newPriceFeed;
        emit UpdateAssetPriceFeed(asset, oldPriceFeed, newPriceFeed);
    }

    function updateAssetBorrowCollateralFactor(address asset, uint64 newBorrowCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        uint64 oldBorrowCF = configuratorParams.assetConfigs[assetIndex].borrowCollateralFactor;
        configuratorParams.assetConfigs[assetIndex].borrowCollateralFactor = newBorrowCF;
        emit UpdateAssetBorrowCollateralFactor(asset, oldBorrowCF, newBorrowCF);
    }

    function updateAssetLiquidateCollateralFactor(address asset, uint64 newLiquidateCF) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        uint64 oldLiquidateCF = configuratorParams.assetConfigs[assetIndex].liquidateCollateralFactor;
        configuratorParams.assetConfigs[assetIndex].liquidateCollateralFactor = newLiquidateCF;
        emit UpdateAssetLiquidateCollateralFactor(asset, oldLiquidateCF, newLiquidateCF);
    }

    function updateAssetLiquidationFactor(address asset, uint64 newLiquidationFactor) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        uint64 oldLiquidationFactor = configuratorParams.assetConfigs[assetIndex].liquidationFactor;
        configuratorParams.assetConfigs[assetIndex].liquidationFactor = newLiquidationFactor;
        emit UpdateAssetLiquidationFactor(asset, oldLiquidationFactor, newLiquidationFactor);
    }

    function updateAssetSupplyCap(address asset, uint128 newSupplyCap) external {
        if (msg.sender != governor) revert Unauthorized();

        uint assetIndex = getAssetIndex(asset);
        uint128 oldSupplyCap = configuratorParams.assetConfigs[assetIndex].supplyCap;
        configuratorParams.assetConfigs[assetIndex].supplyCap = newSupplyCap;
        emit UpdateAssetSupplyCap(asset, oldSupplyCap, newSupplyCap);
    }

    /** Other helpers **/

    /**
     * @dev Determine index of asset that matches given address
     */
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

    /**
     * @return The currently configured params
     **/
    function getConfiguration() external view returns (Configuration memory) {
        return configuratorParams;
    }

    /**
     * @notice Deploy a new version of the Comet implementation.
     * @dev Note: Callable by anyone
     */
    function deploy() external returns (address) {
        address newComet = CometFactory(factory).clone(configuratorParams);
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
