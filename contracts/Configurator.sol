// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity 0.8.13;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./ConfiguratorStorage.sol";

contract Configurator is ConfiguratorStorage {

    /** Custom events **/

    event AddAsset(address asset, address priceFeed, uint8 decimals, uint64 borrowCF, uint64 liquidateCF, uint64 liquidationFactor, uint128 supplyCap);
    event CometDeployed(address newCometAddress);
    event GovernorTransferred(address oldGovernor, address newGovernor);
    event SetFactory(address oldFactory, address newFactory);
    event SetGovernor(address oldGovernor, address newGovernor);
    event SetPauseGuardian(address oldPauseGuardian, address newPauseGuardian);
    event SetBaseToken(address oldBaseToken, address newBaseToken);
    event SetBaseTokenPriceFeed(address oldBaseTokenPriceFeed, address newBaseTokenPriceFeed);
    event SetExtensionDelegate(address oldExt, address newExt);
    event SetKink(uint64 oldKink, uint64 newKink);
    event SetPerYearInterestRateSlopeLow(uint64 oldIRSlopeLow, uint64 newIRSlopeLow);
    event SetPerYearInterestRateSlopeHigh(uint64 oldIRSlopeHigh, uint64 newIRSlopeHigh);
    event SetPerYearInterestRateBase(uint64 oldIRBase, uint64 newIRBase);
    event SetReserveRate(uint64 oldReserveRate, uint64 newReserveRate);
    event SetStoreFrontPriceFactor(uint64 oldStoreFrontPriceFactor, uint64 newStoreFrontPriceFactor);
    event SetTrackingIndexScale(uint64 oldTrackingIndexScale, uint64 newTrackingIndexScale);
    event SetBaseTrackingSupplySpeed(uint64 oldBaseTrackingSupplySpeed, uint64 newBaseTrackingSupplySpeed);
    event SetBaseTrackingBorrowSpeed(uint64 oldBaseTrackingBorrowSpeed, uint64 newBaseTrackingBorrowSpeed);
    event SetBaseMinForRewards(uint104 oldBaseMinForRewards, uint104 newBaseMinForRewards);
    event SetBaseBorrowMin(uint104 oldBaseBorrowMin, uint104 newBaseBorrowMin);
    event SetTargetReserves(uint104 oldTargetReserves, uint104 newTargetReserves);

    /** Custom errors **/

    error AlreadyInitialized();
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

    /// @dev only callable by admin
    function setGovernor(address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldGovernor = configuratorParams.governor;
        configuratorParams.governor = newGovernor;
        emit SetGovernor(oldGovernor, newGovernor);
    }

    /// @dev only callable by admin
    function setPauseGuardian(address newPauseGuardian) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldPauseGuardian = configuratorParams.pauseGuardian;
        configuratorParams.pauseGuardian = newPauseGuardian;
        emit SetPauseGuardian(oldPauseGuardian, newPauseGuardian);
    }

    /// XXX Probably doesn't make sense for governance to change this?
    /// @dev only callable by admin
    function setBaseToken(address newBaseToken) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldBaseToken = configuratorParams.baseToken;
        configuratorParams.baseToken = newBaseToken;
        emit SetBaseToken(oldBaseToken, newBaseToken);
    }

    /// @dev only callable by admin
    function setBaseTokenPriceFeed(address newBaseTokenPriceFeed) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldBaseTokenPriceFeed = configuratorParams.baseTokenPriceFeed;
        configuratorParams.baseTokenPriceFeed = newBaseTokenPriceFeed;
        emit SetBaseTokenPriceFeed(oldBaseTokenPriceFeed, newBaseTokenPriceFeed);
    }

    /// @dev only callable by admin
    function setExtensionDelegate(address newExtensionDelegate) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldExtensionDelegate = configuratorParams.extensionDelegate;
        configuratorParams.extensionDelegate = newExtensionDelegate;
        emit SetExtensionDelegate(oldExtensionDelegate, newExtensionDelegate);
    }

    /// @dev only callable by admin
    function setKink(uint64 newKink) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldKink = configuratorParams.kink;
        configuratorParams.kink = newKink;
        emit SetKink(oldKink, newKink);
    }

    /// @dev only callable by admin
    function setPerYearInterestRateSlopeLow(uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldSlope = configuratorParams.perYearInterestRateSlopeLow;
        configuratorParams.perYearInterestRateSlopeLow = newSlope;
        emit SetPerYearInterestRateSlopeLow(oldSlope, newSlope);
    }

    /// @dev only callable by admin
    function setPerYearInterestRateSlopeHigh(uint64 newSlope) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldSlope = configuratorParams.perYearInterestRateSlopeHigh;
        configuratorParams.perYearInterestRateSlopeHigh = newSlope;
        emit SetPerYearInterestRateSlopeHigh(oldSlope, newSlope);
    }

    /// @dev only callable by admin
    function setPerYearInterestRateBase(uint64 newBase) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBase = configuratorParams.perYearInterestRateBase;
        configuratorParams.perYearInterestRateBase = newBase;
        emit SetPerYearInterestRateBase(oldBase, newBase);
    }

    /// @dev only callable by admin
    function setReserveRate(uint64 newReserveRate) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldReserveRate = configuratorParams.reserveRate;
        configuratorParams.reserveRate = newReserveRate;
        emit SetReserveRate(oldReserveRate, newReserveRate);
    }

    /// @dev only callable by admin
    function setStoreFrontPriceFactor(uint64 newStoreFrontPriceFactor) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldStoreFrontPriceFactor = configuratorParams.storeFrontPriceFactor;
        configuratorParams.storeFrontPriceFactor = newStoreFrontPriceFactor;
        emit SetStoreFrontPriceFactor(oldStoreFrontPriceFactor, newStoreFrontPriceFactor);
    }

    /// XXX Probably doesn't make sense for governance to change this?
    /// @dev only callable by admin
    function setTrackingIndexScale(uint64 newTrackingIndexScale) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldTrackingIndexScale = configuratorParams.trackingIndexScale;
        configuratorParams.trackingIndexScale = newTrackingIndexScale;
        emit SetTrackingIndexScale(oldTrackingIndexScale, newTrackingIndexScale);
    }

    /// @dev only callable by admin
    function setBaseTrackingSupplySpeed(uint64 newBaseTrackingSupplySpeed) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBaseTrackingSupplySpeed = configuratorParams.baseTrackingSupplySpeed;
        configuratorParams.baseTrackingSupplySpeed = newBaseTrackingSupplySpeed;
        emit SetBaseTrackingSupplySpeed(oldBaseTrackingSupplySpeed, newBaseTrackingSupplySpeed);
    }

    /// @dev only callable by admin
    function setBaseTrackingBorrowSpeed(uint64 newBaseTrackingBorrowSpeed) external {
        if (msg.sender != governor) revert Unauthorized();
        uint64 oldBaseTrackingBorrowSpeed = configuratorParams.baseTrackingBorrowSpeed;
        configuratorParams.baseTrackingBorrowSpeed = newBaseTrackingBorrowSpeed;
        emit SetBaseTrackingBorrowSpeed(oldBaseTrackingBorrowSpeed, newBaseTrackingBorrowSpeed);
    }

    /// @dev only callable by admin
    function setBaseMinForRewards(uint104 newBaseMinForRewards) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldBaseMinForRewards = configuratorParams.baseMinForRewards;
        configuratorParams.baseMinForRewards = newBaseMinForRewards;
        emit SetBaseMinForRewards(oldBaseMinForRewards, newBaseMinForRewards);
    }

    /// @dev only callable by admin
    function setBaseBorrowMin(uint104 newBaseBorrowMin) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldBaseBorrowMin = configuratorParams.baseBorrowMin;
        configuratorParams.baseBorrowMin = newBaseBorrowMin;
        emit SetBaseBorrowMin(oldBaseBorrowMin, newBaseBorrowMin);
    }

    /// @dev only callable by admin
    function setTargetReserves(uint104 newTargetReserves) external {
        if (msg.sender != governor) revert Unauthorized();
        uint104 oldTargetReserves = configuratorParams.targetReserves;
        configuratorParams.targetReserves = newTargetReserves;
        emit SetTargetReserves(oldTargetReserves, newTargetReserves);
    }

    // XXX What about removing an asset?
    // XXX Should we check MAX_ASSETS here as well?
    /// @dev only callable by governor
    function addAsset(AssetConfig calldata asset) external {
        if (msg.sender != governor) revert Unauthorized();
        configuratorParams.assetConfigs.push(asset);
        emit AddAsset(
            asset.asset,
            asset.priceFeed,
            asset.decimals,
            asset.borrowCollateralFactor,
            asset.liquidateCollateralFactor,
            asset.liquidationFactor,
            asset.supplyCap
        );
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
