// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometCore.sol";
import "./ERC20.sol";
import "./vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Compound's Comet Contract
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
contract Comet is CometCore {
    /** Custom events **/

    event Supply(address indexed from, address indexed dst, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed src, address indexed to, uint256 amount);

    event SupplyCollateral(address indexed from, address indexed dst, address indexed asset, uint256 amount);
    event TransferCollateral(address indexed from, address indexed to, address indexed asset, uint256 amount);
    event WithdrawCollateral(address indexed src, address indexed to, address indexed asset, uint256 amount);

    /** Custom errors **/

    error AlreadyInitialized();
    error BadAmount();
    error BadAsset();
    error BadDecimals();
    error BadMinimum();
    error BadPrice();
    error BorrowTooSmall();
    error BorrowCFTooLarge();
    error InsufficientReserves();
    error LiquidateCFTooLarge();
    error NoSelfTransfer();
    error NotCollateralized();
    error NotForSale();
    error NotLiquidatable();
    error Paused();
    error SupplyCapExceeded();
    error TimestampTooLarge();
    error TooManyAssets();
    error TooMuchSlippage();
    error TransferInFailed();
    error TransferOutFailed();
    error Unauthorized();

    /** General configuration constants **/

    /// @notice The admin of the protocol
    address public immutable governor;

    /// @notice The account which may trigger pauses
    address public immutable pauseGuardian;

    /// @notice The address of the base token contract
    address public immutable baseToken;

    /// @notice The address of the price feed for the base token
    address public immutable baseTokenPriceFeed;

    /// @notice The address of the extension contract delegate
    address public immutable extensionDelegate;

    /// @notice The point in the supply and borrow rates separating the low interest rate slope and the high interest rate slope (factor)
    /// @dev uint64
    uint public immutable kink;

    /// @notice Per second interest rate slope applied when utilization is below kink (factor)
    /// @dev uint64
    uint public immutable perSecondInterestRateSlopeLow;

    /// @notice Per second interest rate slope applied when utilization is above kink (factor)
    /// @dev uint64
    uint public immutable perSecondInterestRateSlopeHigh;

    /// @notice Per second base interest rate (factor)
    /// @dev uint64
    uint public immutable perSecondInterestRateBase;

    /// @notice The rate of total interest paid that goes into reserves (factor)
    /// @dev uint64
    uint public immutable reserveRate;

    /// @notice The scale for base token (must be less than 18 decimals)
    /// @dev uint64
    uint public immutable baseScale;

    /// @notice The scale for reward tracking
    /// @dev uint64
    uint public immutable trackingIndexScale;

    /// @notice The speed at which supply rewards are tracked (in trackingIndexScale)
    /// @dev uint64
    uint public immutable baseTrackingSupplySpeed;

    /// @notice The speed at which borrow rewards are tracked (in trackingIndexScale)
    /// @dev uint64
    uint public immutable baseTrackingBorrowSpeed;

    /// @notice The minimum amount of base wei for rewards to accrue
    /// @dev This must be large enough so as to prevent division by base wei from overflowing the 64 bit indices
    /// @dev uint104
    uint public immutable baseMinForRewards;

    /// @notice The minimum base amount required to initiate a borrow
    /// @dev uint104
    uint public immutable baseBorrowMin;

    /// @notice The minimum base token reserves which must be held before collateral is hodled
    /// @dev uint104
    uint public immutable targetReserves;

    /// @notice The number of decimals for wrapped base token
    uint8 public immutable decimals;

    /// @notice The number of assets this contract actually supports
    uint8 public immutable numAssets;

    /// @notice Factor to divide by when accruing rewards in order to preserve 6 decimals (i.e. baseScale / 1e6)
    uint internal immutable accrualDescaleFactor;

    /**  Collateral asset configuration (packed) **/

    // XXX
    address internal immutable asset00_address;
    address internal immutable asset01_address;
    address internal immutable asset02_address;
    address internal immutable asset03_address;
    address internal immutable asset04_address;
    address internal immutable asset05_address;
    address internal immutable asset06_address;
    address internal immutable asset07_address;
    address internal immutable asset08_address;
    address internal immutable asset09_address;
    address internal immutable asset10_address;
    address internal immutable asset11_address;
    address internal immutable asset12_address;
    address internal immutable asset13_address;
    address internal immutable asset14_address;

    address internal immutable asset00_priceFeed;
    address internal immutable asset01_priceFeed;
    address internal immutable asset02_priceFeed;
    address internal immutable asset03_priceFeed;
    address internal immutable asset04_priceFeed;
    address internal immutable asset05_priceFeed;
    address internal immutable asset06_priceFeed;
    address internal immutable asset07_priceFeed;
    address internal immutable asset08_priceFeed;
    address internal immutable asset09_priceFeed;
    address internal immutable asset10_priceFeed;
    address internal immutable asset11_priceFeed;
    address internal immutable asset12_priceFeed;
    address internal immutable asset13_priceFeed;
    address internal immutable asset14_priceFeed;

    // uint64
    uint internal immutable asset00_scale;
    uint internal immutable asset01_scale;
    uint internal immutable asset02_scale;
    uint internal immutable asset03_scale;
    uint internal immutable asset04_scale;
    uint internal immutable asset05_scale;
    uint internal immutable asset06_scale;
    uint internal immutable asset07_scale;
    uint internal immutable asset08_scale;
    uint internal immutable asset09_scale;
    uint internal immutable asset10_scale;
    uint internal immutable asset11_scale;
    uint internal immutable asset12_scale;
    uint internal immutable asset13_scale;
    uint internal immutable asset14_scale;

    // uint64
    uint internal immutable asset00_borrowCollateralFactor;
    uint internal immutable asset01_borrowCollateralFactor;
    uint internal immutable asset02_borrowCollateralFactor;
    uint internal immutable asset03_borrowCollateralFactor;
    uint internal immutable asset04_borrowCollateralFactor;
    uint internal immutable asset05_borrowCollateralFactor;
    uint internal immutable asset06_borrowCollateralFactor;
    uint internal immutable asset07_borrowCollateralFactor;
    uint internal immutable asset08_borrowCollateralFactor;
    uint internal immutable asset09_borrowCollateralFactor;
    uint internal immutable asset10_borrowCollateralFactor;
    uint internal immutable asset11_borrowCollateralFactor;
    uint internal immutable asset12_borrowCollateralFactor;
    uint internal immutable asset13_borrowCollateralFactor;
    uint internal immutable asset14_borrowCollateralFactor;

    // uint64
    uint internal immutable asset00_liquidateCollateralFactor;
    uint internal immutable asset01_liquidateCollateralFactor;
    uint internal immutable asset02_liquidateCollateralFactor;
    uint internal immutable asset03_liquidateCollateralFactor;
    uint internal immutable asset04_liquidateCollateralFactor;
    uint internal immutable asset05_liquidateCollateralFactor;
    uint internal immutable asset06_liquidateCollateralFactor;
    uint internal immutable asset07_liquidateCollateralFactor;
    uint internal immutable asset08_liquidateCollateralFactor;
    uint internal immutable asset09_liquidateCollateralFactor;
    uint internal immutable asset10_liquidateCollateralFactor;
    uint internal immutable asset11_liquidateCollateralFactor;
    uint internal immutable asset12_liquidateCollateralFactor;
    uint internal immutable asset13_liquidateCollateralFactor;
    uint internal immutable asset14_liquidateCollateralFactor;

    // uint64
    uint internal immutable asset00_liquidationFactor;
    uint internal immutable asset01_liquidationFactor;
    uint internal immutable asset02_liquidationFactor;
    uint internal immutable asset03_liquidationFactor;
    uint internal immutable asset04_liquidationFactor;
    uint internal immutable asset05_liquidationFactor;
    uint internal immutable asset06_liquidationFactor;
    uint internal immutable asset07_liquidationFactor;
    uint internal immutable asset08_liquidationFactor;
    uint internal immutable asset09_liquidationFactor;
    uint internal immutable asset10_liquidationFactor;
    uint internal immutable asset11_liquidationFactor;
    uint internal immutable asset12_liquidationFactor;
    uint internal immutable asset13_liquidationFactor;
    uint internal immutable asset14_liquidationFactor;

    // uint128
    uint internal immutable asset00_supplyCap;
    uint internal immutable asset01_supplyCap;
    uint internal immutable asset02_supplyCap;
    uint internal immutable asset03_supplyCap;
    uint internal immutable asset04_supplyCap;
    uint internal immutable asset05_supplyCap;
    uint internal immutable asset06_supplyCap;
    uint internal immutable asset07_supplyCap;
    uint internal immutable asset08_supplyCap;
    uint internal immutable asset09_supplyCap;
    uint internal immutable asset10_supplyCap;
    uint internal immutable asset11_supplyCap;
    uint internal immutable asset12_supplyCap;
    uint internal immutable asset13_supplyCap;
    uint internal immutable asset14_supplyCap;

    /**
     * @notice Construct a new protocol instance
     * @param config The mapping of initial/constant parameters
     **/
    constructor(Configuration memory config) {
        // Sanity checks
        uint8 decimals_ = ERC20(config.baseToken).decimals();
        if (decimals_ > MAX_BASE_DECIMALS) revert BadDecimals();
        if (config.assetConfigs.length > MAX_ASSETS) revert TooManyAssets();
        if (config.baseMinForRewards == 0) revert BadMinimum();
        if (AggregatorV3Interface(config.baseTokenPriceFeed).decimals() != PRICE_FEED_DECIMALS) revert BadDecimals();
        // XXX other sanity checks? for rewards?

        // Copy configuration
        unchecked {
            governor = config.governor;
            pauseGuardian = config.pauseGuardian;
            baseToken = config.baseToken;
            baseTokenPriceFeed = config.baseTokenPriceFeed;
            extensionDelegate = config.extensionDelegate;

            decimals = decimals_;
            baseScale = uint64(10 ** decimals_);
            trackingIndexScale = config.trackingIndexScale;
            accrualDescaleFactor = baseScale / 1e6;

            baseMinForRewards = config.baseMinForRewards;
            baseTrackingSupplySpeed = config.baseTrackingSupplySpeed;
            baseTrackingBorrowSpeed = config.baseTrackingBorrowSpeed;

            baseBorrowMin = config.baseBorrowMin;
            targetReserves = config.targetReserves;
        }

        // Set interest rate model configs
        unchecked {
            kink = config.kink;
            perSecondInterestRateSlopeLow = config.perYearInterestRateSlopeLow / SECONDS_PER_YEAR;
            perSecondInterestRateSlopeHigh = config.perYearInterestRateSlopeHigh / SECONDS_PER_YEAR;
            perSecondInterestRateBase = config.perYearInterestRateBase / SECONDS_PER_YEAR;
            reserveRate = config.reserveRate;
        }

        // Set asset info
        numAssets = uint8(config.assetConfigs.length);

        // XXX
        asset00_address = config.assetConfigs[0].asset;
        asset01_address = config.assetConfigs[1].asset;
        asset02_address = config.assetConfigs[2].asset;
        asset03_address = config.assetConfigs[3].asset;
        asset04_address = config.assetConfigs[4].asset;
        asset05_address = config.assetConfigs[5].asset;
        asset06_address = config.assetConfigs[6].asset;
        asset07_address = config.assetConfigs[7].asset;
        asset08_address = config.assetConfigs[8].asset;
        asset09_address = config.assetConfigs[9].asset;
        asset10_address = config.assetConfigs[10].asset;
        asset11_address = config.assetConfigs[11].asset;
        asset12_address = config.assetConfigs[12].asset;
        asset13_address = config.assetConfigs[13].asset;
        asset14_address = config.assetConfigs[14].asset;

        // XXX
        asset00_priceFeed = config.assetConfigs[0].priceFeed;
        asset01_priceFeed = config.assetConfigs[1].priceFeed;
        asset02_priceFeed = config.assetConfigs[2].priceFeed;
        asset03_priceFeed = config.assetConfigs[3].priceFeed;
        asset04_priceFeed = config.assetConfigs[4].priceFeed;
        asset05_priceFeed = config.assetConfigs[5].priceFeed;
        asset06_priceFeed = config.assetConfigs[6].priceFeed;
        asset07_priceFeed = config.assetConfigs[7].priceFeed;
        asset08_priceFeed = config.assetConfigs[8].priceFeed;
        asset09_priceFeed = config.assetConfigs[9].priceFeed;
        asset10_priceFeed = config.assetConfigs[10].priceFeed;
        asset11_priceFeed = config.assetConfigs[11].priceFeed;
        asset12_priceFeed = config.assetConfigs[12].priceFeed;
        asset13_priceFeed = config.assetConfigs[13].priceFeed;
        asset14_priceFeed = config.assetConfigs[14].priceFeed;

        // XXX
        asset00_scale = uint64(10 ** config.assetConfigs[0].decimals);
        asset01_scale = uint64(10 ** config.assetConfigs[1].decimals);
        asset02_scale = uint64(10 ** config.assetConfigs[2].decimals);
        asset03_scale = uint64(10 ** config.assetConfigs[3].decimals);
        asset04_scale = uint64(10 ** config.assetConfigs[4].decimals);
        asset05_scale = uint64(10 ** config.assetConfigs[5].decimals);
        asset06_scale = uint64(10 ** config.assetConfigs[6].decimals);
        asset07_scale = uint64(10 ** config.assetConfigs[7].decimals);
        asset08_scale = uint64(10 ** config.assetConfigs[8].decimals);
        asset09_scale = uint64(10 ** config.assetConfigs[9].decimals);
        asset10_scale = uint64(10 ** config.assetConfigs[10].decimals);
        asset11_scale = uint64(10 ** config.assetConfigs[11].decimals);
        asset12_scale = uint64(10 ** config.assetConfigs[12].decimals);
        asset13_scale = uint64(10 ** config.assetConfigs[13].decimals);
        asset14_scale = uint64(10 ** config.assetConfigs[14].decimals);

        // XXX
        asset00_borrowCollateralFactor = config.assetConfigs[0].borrowCollateralFactor;
        asset01_borrowCollateralFactor = config.assetConfigs[1].borrowCollateralFactor;
        asset02_borrowCollateralFactor = config.assetConfigs[2].borrowCollateralFactor;
        asset03_borrowCollateralFactor = config.assetConfigs[3].borrowCollateralFactor;
        asset04_borrowCollateralFactor = config.assetConfigs[4].borrowCollateralFactor;
        asset05_borrowCollateralFactor = config.assetConfigs[5].borrowCollateralFactor;
        asset06_borrowCollateralFactor = config.assetConfigs[6].borrowCollateralFactor;
        asset07_borrowCollateralFactor = config.assetConfigs[7].borrowCollateralFactor;
        asset08_borrowCollateralFactor = config.assetConfigs[8].borrowCollateralFactor;
        asset09_borrowCollateralFactor = config.assetConfigs[9].borrowCollateralFactor;
        asset10_borrowCollateralFactor = config.assetConfigs[10].borrowCollateralFactor;
        asset11_borrowCollateralFactor = config.assetConfigs[11].borrowCollateralFactor;
        asset12_borrowCollateralFactor = config.assetConfigs[12].borrowCollateralFactor;
        asset13_borrowCollateralFactor = config.assetConfigs[13].borrowCollateralFactor;
        asset14_borrowCollateralFactor = config.assetConfigs[14].borrowCollateralFactor;

        // XXX
        asset00_liquidateCollateralFactor = config.assetConfigs[0].liquidateCollateralFactor;
        asset01_liquidateCollateralFactor = config.assetConfigs[1].liquidateCollateralFactor;
        asset02_liquidateCollateralFactor = config.assetConfigs[2].liquidateCollateralFactor;
        asset03_liquidateCollateralFactor = config.assetConfigs[3].liquidateCollateralFactor;
        asset04_liquidateCollateralFactor = config.assetConfigs[4].liquidateCollateralFactor;
        asset05_liquidateCollateralFactor = config.assetConfigs[5].liquidateCollateralFactor;
        asset06_liquidateCollateralFactor = config.assetConfigs[6].liquidateCollateralFactor;
        asset07_liquidateCollateralFactor = config.assetConfigs[7].liquidateCollateralFactor;
        asset08_liquidateCollateralFactor = config.assetConfigs[8].liquidateCollateralFactor;
        asset09_liquidateCollateralFactor = config.assetConfigs[9].liquidateCollateralFactor;
        asset10_liquidateCollateralFactor = config.assetConfigs[10].liquidateCollateralFactor;
        asset11_liquidateCollateralFactor = config.assetConfigs[11].liquidateCollateralFactor;
        asset12_liquidateCollateralFactor = config.assetConfigs[12].liquidateCollateralFactor;
        asset13_liquidateCollateralFactor = config.assetConfigs[13].liquidateCollateralFactor;
        asset14_liquidateCollateralFactor = config.assetConfigs[14].liquidateCollateralFactor;

        // XXX
        asset00_liquidationFactor = config.assetConfigs[0].liquidationFactor;
        asset01_liquidationFactor = config.assetConfigs[1].liquidationFactor;
        asset02_liquidationFactor = config.assetConfigs[2].liquidationFactor;
        asset03_liquidationFactor = config.assetConfigs[3].liquidationFactor;
        asset04_liquidationFactor = config.assetConfigs[4].liquidationFactor;
        asset05_liquidationFactor = config.assetConfigs[5].liquidationFactor;
        asset06_liquidationFactor = config.assetConfigs[6].liquidationFactor;
        asset07_liquidationFactor = config.assetConfigs[7].liquidationFactor;
        asset08_liquidationFactor = config.assetConfigs[8].liquidationFactor;
        asset09_liquidationFactor = config.assetConfigs[9].liquidationFactor;
        asset10_liquidationFactor = config.assetConfigs[10].liquidationFactor;
        asset11_liquidationFactor = config.assetConfigs[11].liquidationFactor;
        asset12_liquidationFactor = config.assetConfigs[12].liquidationFactor;
        asset13_liquidationFactor = config.assetConfigs[13].liquidationFactor;
        asset14_liquidationFactor = config.assetConfigs[14].liquidationFactor;

        // XXX
        asset00_supplyCap = config.assetConfigs[0].supplyCap;
        asset01_supplyCap = config.assetConfigs[1].supplyCap;
        asset02_supplyCap = config.assetConfigs[2].supplyCap;
        asset03_supplyCap = config.assetConfigs[3].supplyCap;
        asset04_supplyCap = config.assetConfigs[4].supplyCap;
        asset05_supplyCap = config.assetConfigs[5].supplyCap;
        asset06_supplyCap = config.assetConfigs[6].supplyCap;
        asset07_supplyCap = config.assetConfigs[7].supplyCap;
        asset08_supplyCap = config.assetConfigs[8].supplyCap;
        asset09_supplyCap = config.assetConfigs[9].supplyCap;
        asset10_supplyCap = config.assetConfigs[10].supplyCap;
        asset11_supplyCap = config.assetConfigs[11].supplyCap;
        asset12_supplyCap = config.assetConfigs[12].supplyCap;
        asset13_supplyCap = config.assetConfigs[13].supplyCap;
        asset14_supplyCap = config.assetConfigs[14].supplyCap;

        // Initialize storage
        initializeStorage();
    }

    /**
     * @notice Initialize storage for the contract
     * @dev Can be used from constructor or proxy
     */
    function initializeStorage() public {
        if (lastAccrualTime != 0) revert AlreadyInitialized();

        // Initialize aggregates
        lastAccrualTime = getNowInternal();
        baseSupplyIndex = BASE_INDEX_SCALE;
        baseBorrowIndex = BASE_INDEX_SCALE;
        trackingSupplyIndex = 0;
        trackingBorrowIndex = 0;
    }

    /**
     * @dev Determine index of asset that matches given address
     */
    function getAssetOffset(address asset) internal view returns (uint8) {
        for (uint8 i = 0; i < numAssets; i++) {
            if (getAssetAddress(i) == asset) {
                return i;
            }
        }
        revert BadAsset();
    }

    /**
     * @dev Lookup address by asset offset
     */
    function getAssetAddress(uint8 i) internal view returns (address) {
        return [asset00_address, asset01_address, asset02_address, asset03_address, asset04_address, asset05_address, asset06_address, asset07_address, asset08_address, asset09_address, asset10_address, asset11_address, asset12_address, asset13_address, asset14_address][i];
    }

    /**
     * @dev Lookup price feed by asset offset
     */
    function getAssetPriceFeed(uint8 i) internal view returns (address) {
        return [asset00_priceFeed, asset01_priceFeed, asset02_priceFeed, asset03_priceFeed, asset04_priceFeed, asset05_priceFeed, asset06_priceFeed, asset07_priceFeed, asset08_priceFeed, asset09_priceFeed, asset10_priceFeed, asset11_priceFeed, asset12_priceFeed, asset13_priceFeed, asset14_priceFeed][i];
    }

    /**
     * @dev Lookup scale by asset offset
     */
    function getAssetScale(uint8 i) internal view returns (uint64) {
        return uint64([asset00_scale, asset01_scale, asset02_scale, asset03_scale, asset04_scale, asset05_scale, asset06_scale, asset07_scale, asset08_scale, asset09_scale, asset10_scale, asset11_scale, asset12_scale, asset13_scale, asset14_scale][i]);
    }

    /**
     * @dev Lookup borrow collateral factor by asset offset
     */
    function getAssetBorrowCF(uint8 i) internal view returns (uint64) {
        return uint64([asset00_borrowCollateralFactor, asset01_borrowCollateralFactor, asset02_borrowCollateralFactor, asset03_borrowCollateralFactor, asset04_borrowCollateralFactor, asset05_borrowCollateralFactor, asset06_borrowCollateralFactor, asset07_borrowCollateralFactor, asset08_borrowCollateralFactor, asset09_borrowCollateralFactor, asset10_borrowCollateralFactor, asset11_borrowCollateralFactor, asset12_borrowCollateralFactor, asset13_borrowCollateralFactor, asset14_borrowCollateralFactor][i]);
    }

    /**
     * @dev Lookup liquidate collateral factor by asset offset
     */
    function getAssetLiquidateCF(uint8 i) internal view returns (uint64) {
        return uint64([asset00_liquidateCollateralFactor, asset01_liquidateCollateralFactor, asset02_liquidateCollateralFactor, asset03_liquidateCollateralFactor, asset04_liquidateCollateralFactor, asset05_liquidateCollateralFactor, asset06_liquidateCollateralFactor, asset07_liquidateCollateralFactor, asset08_liquidateCollateralFactor, asset09_liquidateCollateralFactor, asset10_liquidateCollateralFactor, asset11_liquidateCollateralFactor, asset12_liquidateCollateralFactor, asset13_liquidateCollateralFactor, asset14_liquidateCollateralFactor][i]);
    }

    /**
     * @dev Lookup liquidation factor by asset offset
     */
    function getAssetLiquidationFactor(uint8 i) internal view returns (uint64) {
        return uint64([asset00_liquidationFactor, asset01_liquidationFactor, asset02_liquidationFactor, asset03_liquidationFactor, asset04_liquidationFactor, asset05_liquidationFactor, asset06_liquidationFactor, asset07_liquidationFactor, asset08_liquidationFactor, asset09_liquidationFactor, asset10_liquidationFactor, asset11_liquidationFactor, asset12_liquidationFactor, asset13_liquidationFactor, asset14_liquidationFactor][i]);
    }

    /**
     * @dev Lookup supply cap by asset offset
     */
    function getAssetSupplyCap(uint8 i) internal view returns (uint64) {
        return uint64([asset00_supplyCap, asset01_supplyCap, asset02_supplyCap, asset03_supplyCap, asset04_supplyCap, asset05_supplyCap, asset06_supplyCap, asset07_supplyCap, asset08_supplyCap, asset09_supplyCap, asset10_supplyCap, asset11_supplyCap, asset12_supplyCap, asset13_supplyCap, asset14_supplyCap][i]);
    }

    /**
     * @return The current timestamp
     **/
    function getNowInternal() virtual internal view returns (uint40) {
        if (block.timestamp >= 2**40) revert TimestampTooLarge();
        return uint40(block.timestamp);
    }

    /**
     * @dev Accrue interest (and rewards) in base token supply and borrows
     **/
    function accrueInternal() internal {
        uint40 now_ = getNowInternal();
        uint timeElapsed = now_ - lastAccrualTime;
        if (timeElapsed > 0) {
            uint supplyRate = getSupplyRate();
            uint borrowRate = getBorrowRate();
            baseSupplyIndex += safe64(mulFactor(baseSupplyIndex, supplyRate * timeElapsed));
            baseBorrowIndex += safe64(mulFactor(baseBorrowIndex, borrowRate * timeElapsed));
            if (totalSupplyBase >= baseMinForRewards) {
                uint supplySpeed = baseTrackingSupplySpeed;
                trackingSupplyIndex += safe64(divBaseWei(supplySpeed * timeElapsed, totalSupplyBase));
            }
            if (totalBorrowBase >= baseMinForRewards) {
                uint borrowSpeed = baseTrackingBorrowSpeed;
                trackingBorrowIndex += safe64(divBaseWei(borrowSpeed * timeElapsed, totalBorrowBase));
            }
            lastAccrualTime = now_;
        }
    }

    /**
     * @return The current per second supply rate
     */
    function getSupplyRate() public view returns (uint64) {
        uint utilization = getUtilization();
        uint reserveScalingFactor = utilization * (FACTOR_SCALE - reserveRate) / FACTOR_SCALE;
        if (utilization <= kink) {
            // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
            return safe64(mulFactor(reserveScalingFactor, (perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, utilization))));
        } else {
            // (interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)) * utilization * (1 - reserveRate)
            return safe64(mulFactor(reserveScalingFactor, (perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, kink) + mulFactor(perSecondInterestRateSlopeHigh, (utilization - kink)))));
        }
    }

    /**
     * @return The current per second borrow rate
     */
    function getBorrowRate() public view returns (uint64) {
        uint utilization = getUtilization();
        if (utilization <= kink) {
            // interestRateBase + interestRateSlopeLow * utilization
            return safe64(perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, utilization));
        } else {
            // interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)
            return safe64(perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, kink) + mulFactor(perSecondInterestRateSlopeHigh, (utilization - kink)));
        }
    }

    /**
     * @return The utilization rate of the base asset
     */
    function getUtilization() public view returns (uint) {
        uint totalSupply = presentValueSupply(baseSupplyIndex, totalSupplyBase);
        uint totalBorrow = presentValueBorrow(baseBorrowIndex, totalBorrowBase);
        if (totalSupply == 0) {
            return 0;
        } else {
            return totalBorrow * FACTOR_SCALE / totalSupply;
        }
    }

    /**
     * @notice Get the current price from a feed
     * @param priceFeed The address of a price feed
     * @return The price, scaled by `PRICE_SCALE`
     */
    function getPrice(address priceFeed) public view returns (uint128) {
        (, int price, , , ) = AggregatorV3Interface(priceFeed).latestRoundData();
        if (price <= 0 || price > type(int128).max) revert BadPrice();
        return uint128(int128(price));
    }

    /**
     * @notice Gets the total amount of protocol reserves, denominated in the number of base tokens
     */
    function getReserves() public view returns (int) {
        uint balance = ERC20(baseToken).balanceOf(address(this));
        uint104 totalSupply = presentValueSupply(baseSupplyIndex, totalSupplyBase);
        uint104 totalBorrow = presentValueBorrow(baseBorrowIndex, totalBorrowBase);
        return signed256(balance) - signed104(totalSupply) + signed104(totalBorrow);
    }

    /**
     * @notice Check whether an account has enough collateral to borrow
     * @param account The address to check
     * @return Whether the account is minimally collateralized enough to borrow
     */
    function isBorrowCollateralized(address account) public view returns (bool) {
        uint16 assetsIn = userBasic[account].assetsIn;

        int liquidity = signedMulPrice(
            presentValue(userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            uint64(baseScale)
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                if (liquidity >= 0) {
                    return true;
                }

                uint newAmount = mulPrice(
                    userCollateral[account][getAssetAddress(i)].balance,
                    getPrice(getAssetPriceFeed(i)),
                    getAssetScale(i)
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    getAssetBorrowCF(i)
                ));
            }
        }

        return liquidity >= 0;
    }

    /**
     * @notice Calculate the amount of borrow liquidity for account
     * @param account The address to check liquidity for
     * @return The common price quantity of borrow liquidity
     */
    function getBorrowLiquidity(address account) public view returns (int) {
        uint16 assetsIn = userBasic[account].assetsIn;

        int liquidity = signedMulPrice(
            presentValue(userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            uint64(baseScale)
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                uint newAmount = mulPrice(
                    userCollateral[account][getAssetAddress(i)].balance,
                    getPrice(getAssetPriceFeed(i)),
                    getAssetScale(i)
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    getAssetBorrowCF(i)
                ));
            }
        }

        return liquidity;
    }

    /**
     * @notice Check whether an account has enough collateral to not be liquidated
     * @param account The address to check
     * @return Whether the account is minimally collateralized enough to not be liquidated
     */
    function isLiquidatable(address account) public view returns (bool) {
        uint16 assetsIn = userBasic[account].assetsIn;

        int liquidity = signedMulPrice(
            presentValue(userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            uint64(baseScale)
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                if (liquidity >= 0) {
                    return false;
                }

                uint newAmount = mulPrice(
                    userCollateral[account][getAssetAddress(i)].balance,
                    getPrice(getAssetPriceFeed(i)),
                    getAssetScale(i)
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    getAssetLiquidateCF(i)
                ));
            }
        }

        return liquidity < 0;
    }

    /**
     * @notice Calculate the amount of liquidation margin for account
     * @param account The address to check margin for
     * @return The common price quantity of liquidation margin
     */
    function getLiquidationMargin(address account) public view returns (int) {
        uint16 assetsIn = userBasic[account].assetsIn;

        int liquidity = signedMulPrice(
            presentValue(userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            uint64(baseScale)
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                uint newAmount = mulPrice(
                    userCollateral[account][getAssetAddress(i)].balance,
                    getPrice(getAssetPriceFeed(i)),
                    getAssetScale(i)
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    getAssetLiquidateCF(i)
                ));
            }
        }

        return liquidity;
    }

    /**
     * @dev The amounts broken into repay and supply amounts, given negative balance
     */
    function repayAndSupplyAmount(int104 balance, uint104 amount) internal pure returns (uint104, uint104) {
        uint104 repayAmount = balance < 0 ? min(unsigned104(-balance), amount) : 0;
        uint104 supplyAmount = amount - repayAmount;
        return (repayAmount, supplyAmount);
    }

    /**
     * @dev The amounts broken into withdraw and borrow amounts, given positive balance
     */
    function withdrawAndBorrowAmount(int104 balance, uint104 amount) internal pure returns (uint104, uint104) {
        uint104 withdrawAmount = balance > 0 ? min(unsigned104(balance), amount) : 0;
        uint104 borrowAmount = amount - withdrawAmount;
        return (withdrawAmount, borrowAmount);
    }

    /**
     * @notice Pauses different actions within Comet
     * @param supplyPaused Boolean for pausing supply actions
     * @param transferPaused Boolean for pausing transfer actions
     * @param withdrawPaused Boolean for pausing withdraw actions
     * @param absorbPaused Boolean for pausing absorb actions
     * @param buyPaused Boolean for pausing buy actions
     */
    function pause(
        bool supplyPaused,
        bool transferPaused,
        bool withdrawPaused,
        bool absorbPaused,
        bool buyPaused
    ) external {
        if (msg.sender != governor && msg.sender != pauseGuardian) revert Unauthorized();

        pauseFlags =
            uint8(0) |
            (toUInt8(supplyPaused) << PAUSE_SUPPLY_OFFSET) |
            (toUInt8(transferPaused) << PAUSE_TRANSFER_OFFSET) |
            (toUInt8(withdrawPaused) << PAUSE_WITHDRAW_OFFSET) |
            (toUInt8(absorbPaused) << PAUSE_ABSORB_OFFSET) |
            (toUInt8(buyPaused) << PAUSE_BUY_OFFSET);
    }

    /**
     * @return Whether or not supply actions are paused
     */
    function isSupplyPaused() public view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_SUPPLY_OFFSET));
    }

    /**
     * @return Whether or not transfer actions are paused
     */
    function isTransferPaused() public view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_TRANSFER_OFFSET));
    }

    /**
     * @return Whether or not withdraw actions are paused
     */
    function isWithdrawPaused() public view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_WITHDRAW_OFFSET));
    }

    /**
     * @return Whether or not absorb actions are paused
     */
    function isAbsorbPaused() public view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_ABSORB_OFFSET));
    }

    /**
     * @return Whether or not buy actions are paused
     */
    function isBuyPaused() public view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_BUY_OFFSET));
    }

    /**
     * @dev Multiply a number by a factor
     */
    function mulFactor(uint n, uint factor) internal pure returns (uint) {
        return n * factor / FACTOR_SCALE;
    }

    /**
     * @dev Divide a number by an amount of base
     */
    function divBaseWei(uint n, uint baseWei) internal view returns (uint) {
        return n * baseScale / baseWei;
    }

    /**
     * @dev Multiply a `fromScale` quantity by a price, returning a common price quantity
     */
    function mulPrice(uint128 n, uint128 price, uint64 fromScale) internal pure returns (uint) {
        unchecked {
            return uint256(n) * price / fromScale;
        }
    }

    /**
     * @dev Multiply a signed `fromScale` quantity by a price, returning a common price quantity
     */
    function signedMulPrice(int128 n, uint128 price, uint64 fromScale) internal pure returns (int) {
        unchecked {
            return n * signed256(price) / signed256(fromScale);
        }
    }

    /**
     * @dev Divide a common price quantity by a price, returning a `toScale` quantity
     */
    function divPrice(uint n, uint price, uint64 toScale) internal pure returns (uint) {
        return n * toScale / price;
    }

    /**
     * @dev Whether user has a non-zero balance of an asset, given assetsIn flags
     */
    function isInAsset(uint16 assetsIn, uint8 assetOffset) internal pure returns (bool) {
        return (assetsIn & (uint16(1) << assetOffset) != 0);
    }

    /**
     * @dev Update assetsIn bit vector if user has entered or exited an asset
     */
    function updateAssetsIn(
        address account,
        address asset,
        uint128 initialUserBalance,
        uint128 finalUserBalance
    ) internal {
        uint8 offset = getAssetOffset(asset);
        if (initialUserBalance == 0 && finalUserBalance != 0) {
            // set bit for asset
            userBasic[account].assetsIn |= (uint16(1) << offset);
        } else if (initialUserBalance != 0 && finalUserBalance == 0) {
            // clear bit for asset
            userBasic[account].assetsIn &= ~(uint16(1) << offset);
        }
    }

    /**
     * @dev Write updated balance to store and tracking participation
     */
    function updateBaseBalance(address account, UserBasic memory basic, int104 principalNew) internal {
        int104 principal = basic.principal;
        basic.principal = principalNew;

        if (principal >= 0) {
            uint indexDelta = trackingSupplyIndex - basic.baseTrackingIndex;
            basic.baseTrackingAccrued += safe64(uint104(principal) * indexDelta / trackingIndexScale / accrualDescaleFactor);
        } else {
            uint indexDelta = trackingBorrowIndex - basic.baseTrackingIndex;
            basic.baseTrackingAccrued += safe64(uint104(-principal) * indexDelta / trackingIndexScale / accrualDescaleFactor);
        }

        if (principalNew >= 0) {
            basic.baseTrackingIndex = trackingSupplyIndex;
        } else {
            basic.baseTrackingIndex = trackingBorrowIndex;
        }

        userBasic[account] = basic;
    }

    /**
     * @dev Safe ERC20 transfer in, assumes no fee is charged and amount is transferred
     */
    function doTransferIn(address asset, address from, uint amount) internal {
        bool success = ERC20(asset).transferFrom(from, address(this), amount);
        if (!success) revert TransferInFailed();
    }

    /**
     * @dev Safe ERC20 transfer out
     */
    function doTransferOut(address asset, address to, uint amount) internal {
        bool success = ERC20(asset).transfer(to, amount);
        if (!success) revert TransferOutFailed();
    }

    /**
     * @notice Supply an amount of asset to the protocol
     * @param asset The asset to supply
     * @param amount The quantity to supply
     */
    function supply(address asset, uint amount) external {
        return supplyInternal(msg.sender, msg.sender, msg.sender, asset, amount);
    }

    /**
     * @notice Supply an amount of asset to dst
     * @param dst The address which will hold the balance
     * @param asset The asset to supply
     * @param amount The quantity to supply
     */
    function supplyTo(address dst, address asset, uint amount) external {
        return supplyInternal(msg.sender, msg.sender, dst, asset, amount);
    }

    /**
     * @notice Supply an amount of asset from `from` to dst, if allowed
     * @param from The supplier address
     * @param dst The address which will hold the balance
     * @param asset The asset to supply
     * @param amount The quantity to supply
     */
    function supplyFrom(address from, address dst, address asset, uint amount) external {
        return supplyInternal(msg.sender, from, dst, asset, amount);
    }

    /**
     * @dev Supply either collateral or base asset, depending on the asset, if operator is allowed
     */
    function supplyInternal(address operator, address from, address dst, address asset, uint amount) internal {
        if (isSupplyPaused()) revert Paused();
        if (!hasPermission(from, operator)) revert Unauthorized();

        if (asset == baseToken) {
            return supplyBase(from, dst, safe104(amount));
        } else {
            return supplyCollateral(from, dst, asset, safe128(amount));
        }
    }

    /**
     * @dev Supply an amount of base asset from `from` to dst
     */
    function supplyBase(address from, address dst, uint104 amount) internal {
        doTransferIn(baseToken, from, amount);

        accrueInternal();

        uint104 totalSupplyBalance = presentValueSupply(baseSupplyIndex, totalSupplyBase);
        uint104 totalBorrowBalance = presentValueBorrow(baseBorrowIndex, totalBorrowBase);

        UserBasic memory dstUser = userBasic[dst];
        int104 dstBalance = presentValue(dstUser.principal);

        (uint104 repayAmount, uint104 supplyAmount) = repayAndSupplyAmount(dstBalance, amount);

        totalSupplyBalance += supplyAmount;
        totalBorrowBalance -= repayAmount;

        dstBalance += signed104(amount);

        totalSupplyBase = principalValueSupply(baseSupplyIndex, totalSupplyBalance);
        totalBorrowBase = principalValueBorrow(baseBorrowIndex, totalBorrowBalance);

        updateBaseBalance(dst, dstUser, principalValue(dstBalance));

        emit Supply(from, dst, amount);
    }

    /**
     * @dev Supply an amount of collateral asset from `from` to dst
     */
    function supplyCollateral(address from, address dst, address asset, uint128 amount) internal {
        doTransferIn(asset, from, amount);

        uint8 offset = getAssetOffset(asset);
        uint128 supplyCap = getAssetSupplyCap(offset);

        TotalsCollateral memory totals = totalsCollateral[asset];
        totals.totalSupplyAsset += amount;
        if (totals.totalSupplyAsset > supplyCap) revert SupplyCapExceeded();

        uint128 dstCollateral = userCollateral[dst][asset].balance;
        uint128 dstCollateralNew = dstCollateral + amount;

        totalsCollateral[asset] = totals;
        userCollateral[dst][asset].balance = dstCollateralNew;

        updateAssetsIn(dst, asset, dstCollateral, dstCollateralNew);

        emit SupplyCollateral(from, dst, asset, amount);
    }

    /**
     * @notice ERC20 transfer an amount of base token to dst
     * @param dst The recipient address
     * @param amount The quantity to transfer
     * @return true
     */
    function transfer(address dst, uint amount) external returns (bool) {
        transferInternal(msg.sender, msg.sender, dst, baseToken, amount);
        return true;
    }

    /**
     * @notice ERC20 transfer an amount of base token from src to dst, if allowed
     * @param src The sender address
     * @param dst The recipient address
     * @param amount The quantity to transfer
     * @return true
     */
    function transferFrom(address src, address dst, uint amount) external returns (bool) {
        transferInternal(msg.sender, src, dst, baseToken, amount);
        return true;
    }

    /**
     * @notice Transfer an amount of asset to dst
     * @param dst The recipient address
     * @param asset The asset to transfer
     * @param amount The quantity to transfer
     */
    function transferAsset(address dst, address asset, uint amount) external {
        return transferInternal(msg.sender, msg.sender, dst, asset, amount);
    }

    /**
     * @notice Transfer an amount of asset from src to dst, if allowed
     * @param src The sender address
     * @param dst The recipient address
     * @param asset The asset to transfer
     * @param amount The quantity to transfer
     */
    function transferAssetFrom(address src, address dst, address asset, uint amount) external {
        return transferInternal(msg.sender, src, dst, asset, amount);
    }

    /**
     * @dev Transfer either collateral or base asset, depending on the asset, if operator is allowed
     */
    function transferInternal(address operator, address src, address dst, address asset, uint amount) internal {
        if (isTransferPaused()) revert Paused();
        if (!hasPermission(src, operator)) revert Unauthorized();
        if (src == dst) revert NoSelfTransfer();

        if (asset == baseToken) {
            return transferBase(src, dst, safe104(amount));
        } else {
            return transferCollateral(src, dst, asset, safe128(amount));
        }
    }

    /**
     * @dev Transfer an amount of base asset from src to dst, borrowing if possible/necessary
     */
    function transferBase(address src, address dst, uint104 amount) internal {
        accrueInternal();

        uint104 totalSupplyBalance = presentValueSupply(baseSupplyIndex, totalSupplyBase);
        uint104 totalBorrowBalance = presentValueBorrow(baseBorrowIndex, totalBorrowBase);

        UserBasic memory srcUser = userBasic[src];
        UserBasic memory dstUser = userBasic[dst];
        int104 srcBalance = presentValue(srcUser.principal);
        int104 dstBalance = presentValue(dstUser.principal);

        (uint104 withdrawAmount, uint104 borrowAmount) = withdrawAndBorrowAmount(srcBalance, amount);
        (uint104 repayAmount, uint104 supplyAmount) = repayAndSupplyAmount(dstBalance, amount);

        totalSupplyBalance += supplyAmount - withdrawAmount;
        totalBorrowBalance += borrowAmount - repayAmount;

        srcBalance -= signed104(amount);
        dstBalance += signed104(amount);

        totalSupplyBase = principalValueSupply(baseSupplyIndex, totalSupplyBalance);
        totalBorrowBase = principalValueBorrow(baseBorrowIndex, totalBorrowBalance);

        updateBaseBalance(src, srcUser, principalValue(srcBalance));
        updateBaseBalance(dst, dstUser, principalValue(dstBalance));

        if (srcBalance < 0) {
            if (uint104(-srcBalance) < baseBorrowMin) revert BorrowTooSmall();
            if (!isBorrowCollateralized(src)) revert NotCollateralized();
        }

        emit Transfer(src, dst, amount);
    }

    /**
     * @dev Transfer an amount of collateral asset from src to dst
     */
    function transferCollateral(address src, address dst, address asset, uint128 amount) internal {
        uint128 srcCollateral = userCollateral[src][asset].balance;
        uint128 dstCollateral = userCollateral[dst][asset].balance;
        uint128 srcCollateralNew = srcCollateral - amount;
        uint128 dstCollateralNew = dstCollateral + amount;

        userCollateral[src][asset].balance = srcCollateralNew;
        userCollateral[dst][asset].balance = dstCollateralNew;

        updateAssetsIn(src, asset, srcCollateral, srcCollateralNew);
        updateAssetsIn(dst, asset, dstCollateral, dstCollateralNew);

        // Note: no accrue interest, BorrowCF < LiquidationCF covers small changes
        if (!isBorrowCollateralized(src)) revert NotCollateralized();

        emit TransferCollateral(src, dst, asset, amount);
    }

    /**
     * @notice Withdraw an amount of asset from the protocol
     * @param asset The asset to withdraw
     * @param amount The quantity to withdraw
     */
    function withdraw(address asset, uint amount) external {
        return withdrawInternal(msg.sender, msg.sender, msg.sender, asset, amount);
    }

    /**
     * @notice Withdraw an amount of asset to `to`
     * @param to The recipient address
     * @param asset The asset to withdraw
     * @param amount The quantity to withdraw
     */
    function withdrawTo(address to, address asset, uint amount) external {
        return withdrawInternal(msg.sender, msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraw an amount of asset from src to `to`, if allowed
     * @param src The sender address
     * @param to The recipient address
     * @param asset The asset to withdraw
     * @param amount The quantity to withdraw
     */
    function withdrawFrom(address src, address to, address asset, uint amount) external {
        return withdrawInternal(msg.sender, src, to, asset, amount);
    }

    /**
     * @dev Withdraw either collateral or base asset, depending on the asset, if operator is allowed
     */
    function withdrawInternal(address operator, address src, address to, address asset, uint amount) internal {
        if (isWithdrawPaused()) revert Paused();
        if (!hasPermission(src, operator)) revert Unauthorized();

        if (asset == baseToken) {
            return withdrawBase(src, to, safe104(amount));
        } else {
            return withdrawCollateral(src, to, asset, safe128(amount));
        }
    }

    /**
     * @dev Withdraw an amount of base asset from src to `to`, borrowing if possible/necessary
     */
    function withdrawBase(address src, address to, uint104 amount) internal {
        accrueInternal();

        uint104 totalSupplyBalance = presentValueSupply(baseSupplyIndex, totalSupplyBase);
        uint104 totalBorrowBalance = presentValueBorrow(baseBorrowIndex, totalBorrowBase);

        UserBasic memory srcUser = userBasic[src];
        int104 srcBalance = presentValue(srcUser.principal);

        (uint104 withdrawAmount, uint104 borrowAmount) = withdrawAndBorrowAmount(srcBalance, amount);

        totalSupplyBalance -= withdrawAmount;
        totalBorrowBalance += borrowAmount;

        srcBalance -= signed104(amount);

        totalSupplyBase = principalValueSupply(baseSupplyIndex, totalSupplyBalance);
        totalBorrowBase = principalValueBorrow(baseBorrowIndex, totalBorrowBalance);

        updateBaseBalance(src, srcUser, principalValue(srcBalance));

        if (srcBalance < 0) {
            if (uint104(-srcBalance) < baseBorrowMin) revert BorrowTooSmall();
            if (!isBorrowCollateralized(src)) revert NotCollateralized();
        }

        doTransferOut(baseToken, to, amount);

        emit Withdraw(src, to, amount);
    }

    /**
     * @dev Withdraw an amount of collateral asset from src to `to`
     */
    function withdrawCollateral(address src, address to, address asset, uint128 amount) internal {
        uint128 srcCollateral = userCollateral[src][asset].balance;
        uint128 srcCollateralNew = srcCollateral - amount;

        totalsCollateral[asset].totalSupplyAsset -= amount;
        userCollateral[src][asset].balance = srcCollateralNew;

        updateAssetsIn(src, asset, srcCollateral, srcCollateralNew);

        // Note: no accrue interest, BorrowCF < LiquidationCF covers small changes
        if (!isBorrowCollateralized(src)) revert NotCollateralized();

        doTransferOut(asset, to, amount);

        emit WithdrawCollateral(src, to, asset, amount);
    }

    /**
     * @notice Absorb a list of underwater accounts onto the protocol balance sheet
     * @param absorber The recipient of the incentive paid to the caller of absorb
     * @param accounts The list of underwater accounts to absorb
     */
    function absorb(address absorber, address[] calldata accounts) external {
        if (isAbsorbPaused()) revert Paused();

        accrueInternal();

        uint startGas = gasleft();
        for (uint i = 0; i < accounts.length; i++) {
            absorbInternal(accounts[i]);
        }
        uint gasUsed = startGas - gasleft();

        LiquidatorPoints memory points = liquidatorPoints[absorber];
        points.numAbsorbs++;
        points.numAbsorbed += safe64(accounts.length);
        points.approxSpend += safe128(gasUsed * block.basefee);
        liquidatorPoints[absorber] = points;
    }

    /**
     * @dev Transfer user's collateral and debt to the protocol itself.
     */
    function absorbInternal(address account) internal {
        if (!isLiquidatable(account)) revert NotLiquidatable();

        UserBasic memory accountUser = userBasic[account];
        int104 oldBalance = presentValue(accountUser.principal);
        uint16 assetsIn = accountUser.assetsIn;

        uint128 basePrice = getPrice(baseTokenPriceFeed);
        uint deltaValue = 0;

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                address asset = getAssetAddress(i);
                uint128 seizeAmount = userCollateral[account][asset].balance;
                userCollateral[account][asset].balance = 0;
                userCollateral[address(this)][asset].balance += seizeAmount;

                uint value = mulPrice(seizeAmount, getPrice(getAssetPriceFeed(i)), getAssetScale(i));
                deltaValue += mulFactor(value, getAssetLiquidationFactor(i));
            }
        }

        uint104 deltaBalance = safe104(divPrice(deltaValue, basePrice, uint64(baseScale)));
        int104 newBalance = oldBalance + signed104(deltaBalance);
        // New balance will not be negative, all excess debt absorbed by reserves
        if (newBalance < 0) {
            newBalance = 0;
        }
        updateBaseBalance(account, accountUser, principalValue(newBalance));

        // reset assetsIn
        userBasic[account].assetsIn = 0;

        // Reserves are decreased by increasing total supply and decreasing borrows
        //  the amount of debt repaid by reserves is `newBalance - oldBalance`
        // Note: new balance must be non-negative due to the above thresholding
        totalSupplyBase += principalValueSupply(baseSupplyIndex, unsigned104(newBalance));
        // Note: old balance must be negative since the account is liquidatable
        totalBorrowBase -= principalValueBorrow(baseBorrowIndex, unsigned104(-oldBalance));
    }

    /**
     * @notice Buy collateral from the protocol using base tokens, increasing protocol reserves
       A minimum collateral amount should be specified to indicate the maximum slippage acceptable for the buyer.
     * @param asset The asset to buy
     * @param minAmount The minimum amount of collateral tokens that should be received by the buyer
     * @param baseAmount The amount of base tokens used to buy the collateral
     * @param recipient The recipient address
     */
    function buyCollateral(address asset, uint minAmount, uint baseAmount, address recipient) external {
        if (isBuyPaused()) revert Paused();

        accrueInternal();

        int reserves = getReserves();
        if (reserves >= 0 && uint(reserves) >= targetReserves) revert NotForSale();

        // XXX check re-entrancy
        doTransferIn(baseToken, msg.sender, baseAmount);

        uint collateralAmount = quoteCollateral(asset, baseAmount);
        if (collateralAmount < minAmount) revert TooMuchSlippage();

        withdrawCollateral(address(this), recipient, asset, safe128(collateralAmount));
    }

    /**
     * @notice Gets the quote for a collateral asset in exchange for an amount of base asset
     * @param asset The collateral asset to get the quote for
     * @param baseAmount The amount of the base asset to get the quote for
     * @return The quote in terms of the collateral asset
     */
    function quoteCollateral(address asset, uint baseAmount) public view returns (uint) {
        // XXX: Add StoreFrontDiscount.
        uint8 offset = getAssetOffset(asset);
        uint128 assetPrice = getPrice(getAssetPriceFeed(offset));
        uint128 basePrice = getPrice(baseTokenPriceFeed);
        uint assetWeiPerUnitBase = getAssetScale(offset) * basePrice / assetPrice;
        return assetWeiPerUnitBase * baseAmount / baseScale;
    }

    /**
     * @notice Withdraws base token reserves if called by the governor
     * @param to An address of the receiver of withdrawn reserves
     * @param amount The amount of reserves to be withdrawn from the protocol
     */
    function withdrawReserves(address to, uint amount) external {
        if (msg.sender != governor) revert Unauthorized();

        accrueInternal();

        if (amount > unsigned256(getReserves())) revert InsufficientReserves();

        doTransferOut(baseToken, to, amount);
    }

    /**
     * @notice Fallback to calling the extension delegate for everything else
     */
    fallback() external payable {
        address delegate = extensionDelegate;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), delegate, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
