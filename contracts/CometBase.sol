// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometStorage.sol";
import "./CometMath.sol";
import "./ERC20.sol";
import "./vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

abstract contract CometBase is CometStorage, CometMath {
    struct AssetInfo {
        uint8 offset;
        address asset;
        address priceFeed;
        uint64 scale;
        uint64 borrowCollateralFactor;
        uint64 liquidateCollateralFactor;
        uint64 liquidationFactor;
        uint128 supplyCap;
    }

    struct AssetConfig {
        address asset;
        address priceFeed;
        uint8 decimals;
        uint64 borrowCollateralFactor;
        uint64 liquidateCollateralFactor;
        uint64 liquidationFactor;
        uint128 supplyCap;
    }

    struct Configuration {
        address governor;
        address pauseGuardian;
        address baseToken;
        address baseTokenPriceFeed;
        address absorberContract;

        uint64 kink;
        uint64 perYearInterestRateSlopeLow;
        uint64 perYearInterestRateSlopeHigh;
        uint64 perYearInterestRateBase;
        uint64 reserveRate;
        uint64 trackingIndexScale;
        uint64 baseTrackingSupplySpeed;
        uint64 baseTrackingBorrowSpeed;
        uint104 baseMinForRewards;
        uint104 baseBorrowMin;
        uint104 targetReserves;

        AssetConfig[] assetConfigs;
    }

    uint8 internal constant PAUSE_BUY_OFFSET = 4;

    /// @notice The address of the base token contract
    address public immutable baseToken;

    /// @notice The minimum base token reserves which must be held before collateral is hodled
    uint104 public immutable targetReserves;

    /// @notice The scale for factors
    uint64 public constant factorScale = 1e18;

    /// @notice The minimum amount of base wei for rewards to accrue
    /// @dev This must be large enough so as to prevent division by base wei from overflowing the 64 bit indices.
    uint104 public immutable baseMinForRewards;

    /// @notice The speed at which supply rewards are tracked (in trackingIndexScale)
    uint64 public immutable baseTrackingSupplySpeed;

    /// @notice The speed at which borrow rewards are tracked (in trackingIndexScale)
    uint64 public immutable baseTrackingBorrowSpeed;

    /// @notice The rate of total interest paid that goes into reserves (factor)
    uint64 public immutable reserveRate;

    /// @notice The point in the supply and borrow rates separating the low interest rate slope and the high interest rate slope (factor)
    uint64 public immutable kink;

    /// @notice Per second base interest rate (factor)
    uint64 public immutable perSecondInterestRateBase;

    /// @notice Per second interest rate slope applied when utilization is below kink (factor)
    uint64 public immutable perSecondInterestRateSlopeLow;

    /// @notice Per second interest rate slope applied when utilization is above kink (factor)
    uint64 public immutable perSecondInterestRateSlopeHigh;

    /// @notice The scale for base token (must be less than 18 decimals)
    uint64 public immutable baseScale;

    /// @notice The scale for base index (depends on time/rate scales, not base token)
    uint64 public constant baseIndexScale = 1e15;

    /// @dev 365 days * 24 hours * 60 minutes * 60 seconds
    uint64 internal constant SECONDS_PER_YEAR = 31_536_000;

    /// @notice The address of the price feed for the base token
    address public immutable baseTokenPriceFeed;

    /// @notice The decimals required for a price feed
    uint8 public constant priceFeedDecimals = 8;

    /// @notice The number of assets this contract actually supports
    uint8 public immutable numAssets;

    /// @notice The max value for a collateral factor (1)
    uint64 public constant maxCollateralFactor = factorScale;

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
        // uint104 public immutable baseMinForRewards;
        require(config.baseMinForRewards > 0, "baseMinForRewards should be > 0");
        baseMinForRewards = config.baseMinForRewards;
        // uint64 public immutable baseTrackingSupplySpeed;
        baseTrackingSupplySpeed = config.baseTrackingSupplySpeed;
        // uint64 public immutable baseTrackingBorrowSpeed;
        baseTrackingBorrowSpeed = config.baseTrackingBorrowSpeed;
        // uint64 public immutable reserveRate;
        reserveRate = config.reserveRate;
        // uint64 public immutable kink;
        kink = config.kink;
        // uint64 public immutable perSecondInterestRateBase;
        perSecondInterestRateBase = config.perYearInterestRateBase / SECONDS_PER_YEAR;
        // uint64 public immutable perSecondInterestRateSlopeLow;
        perSecondInterestRateSlopeLow = config.perYearInterestRateSlopeLow / SECONDS_PER_YEAR;
        // uint64 public immutable perSecondInterestRateSlopeHigh;
        perSecondInterestRateSlopeHigh = config.perYearInterestRateSlopeHigh / SECONDS_PER_YEAR;
        // uint64 public immutable baseScale;
        uint decimals = ERC20(config.baseToken).decimals();
        require(decimals <= 18, "base token has too many decimals");
        baseScale = uint64(10 ** decimals);

        require(AggregatorV3Interface(config.baseTokenPriceFeed).decimals() == priceFeedDecimals, "bad price feed decimals");
        baseTokenPriceFeed = config.baseTokenPriceFeed;

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

        baseToken = config.baseToken;
        targetReserves = config.targetReserves;
    }

    /**
     * @notice Accrue interest (and rewards) in base token supply and borrows
     **/
    function accrue() public {
        totalsBasic = accrue(totalsBasic);
    }

    /**
     * @notice Accrue interest (and rewards) in base token supply and borrows
     **/
    function accrue(TotalsBasic memory totals) internal view returns (TotalsBasic memory) {
        uint40 now_ = getNow();
        uint timeElapsed = now_ - totals.lastAccrualTime;
        if (timeElapsed > 0) {
            uint supplyRate = getSupplyRateInternal(totals);
            uint borrowRate = getBorrowRateInternal(totals);
            totals.baseSupplyIndex += safe64(mulFactor(totals.baseSupplyIndex, supplyRate * timeElapsed));
            totals.baseBorrowIndex += safe64(mulFactor(totals.baseBorrowIndex, borrowRate * timeElapsed));
            if (totals.totalSupplyBase >= baseMinForRewards) {
                uint supplySpeed = baseTrackingSupplySpeed;
                totals.trackingSupplyIndex += safe64(divBaseWei(supplySpeed * timeElapsed, totals.totalSupplyBase));
            }
            if (totals.totalBorrowBase >= baseMinForRewards) {
                uint borrowSpeed = baseTrackingBorrowSpeed;
                totals.trackingBorrowIndex += safe64(divBaseWei(borrowSpeed * timeElapsed, totals.totalBorrowBase));
            }
        }
        totals.lastAccrualTime = now_;
        return totals;
    }

    /**
     * @return The current timestamp
     **/
    function getNow() virtual public view returns (uint40) {
        require(block.timestamp < 2**40, "timestamp exceeds size (40 bits)");
        return uint40(block.timestamp);
    }

    /**
     * @return The current per second supply rate
     */
    function getSupplyRate() public view returns (uint64) {
        return getSupplyRateInternal(totalsBasic);
    }

    /**
     * @dev Calculate current per second supply rate given totals
     */
    function getSupplyRateInternal(TotalsBasic memory totals) internal view returns (uint64) {
        uint utilization = getUtilizationInternal(totals);
        uint reserveScalingFactor = utilization * (factorScale - reserveRate) / factorScale;
        if (utilization <= kink) {
            // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
            return safe64(mulFactor(reserveScalingFactor, (perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, utilization))));
        } else {
            // (interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)) * utilization * (1 - reserveRate)
            return safe64(mulFactor(reserveScalingFactor, (perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, kink) + mulFactor(perSecondInterestRateSlopeHigh, (utilization - kink)))));
        }
    }

    /**
     * @return The utilization rate of the base asset
     */
    function getUtilization() public view returns (uint) {
        return getUtilizationInternal(totalsBasic);
    }

    /**
     * @dev Calculate utilization rate of the base asset given totals
     */
    function getUtilizationInternal(TotalsBasic memory totals) internal pure returns (uint) {
        uint totalSupply = presentValueSupply(totals, totals.totalSupplyBase);
        uint totalBorrow = presentValueBorrow(totals, totals.totalBorrowBase);
        if (totalSupply == 0) {
            return 0;
        } else {
            return totalBorrow * factorScale / totalSupply;
        }
    }

    /**
     * @return The current per second borrow rate
     */
    function getBorrowRate() public view returns (uint64) {
        return getBorrowRateInternal(totalsBasic);
    }

    /**
     * @dev Calculate current per second borrow rate given totals
     */
    function getBorrowRateInternal(TotalsBasic memory totals) internal view returns (uint64) {
        uint utilization = getUtilizationInternal(totals);
        if (utilization <= kink) {
            // interestRateBase + interestRateSlopeLow * utilization
            return safe64(perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, utilization));
        } else {
            // interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)
            return safe64(perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, kink) + mulFactor(perSecondInterestRateSlopeHigh, (utilization - kink)));
        }
    }

    /**
     * @dev Multiply a number by a factor
     */
    function mulFactor(uint n, uint factor) internal pure returns (uint) {
        return n * factor / factorScale;
    }

    /**
     * @dev Divide a number by an amount of base
     */
    function divBaseWei(uint n, uint baseWei) internal view returns (uint) {
        return n * baseScale / baseWei;
    }

    /**
     * @dev The principal amount projected forward by the supply index
     */
    function presentValueSupply(TotalsBasic memory totals, uint104 principalValue_) internal pure returns (uint104) {
        return uint104(uint(principalValue_) * totals.baseSupplyIndex / baseIndexScale);
    }

    /**
     * @dev The principal amount projected forward by the borrow index
     */
    function presentValueBorrow(TotalsBasic memory totals, uint104 principalValue_) internal pure returns (uint104) {
        return uint104(uint(principalValue_) * totals.baseBorrowIndex / baseIndexScale);
    }

    /**
     * @dev The positive present supply balance if positive or the negative borrow balance if negative
     */
    function presentValue(TotalsBasic memory totals, int104 principalValue_) internal pure returns (int104) {
        if (principalValue_ >= 0) {
            return signed104(presentValueSupply(totals, unsigned104(principalValue_)));
        } else {
            return -signed104(presentValueBorrow(totals, unsigned104(-principalValue_)));
        }
    }

    /**
     * @notice Get the current price from a feed
     * @param priceFeed The address of a price feed
     * @return The price, scaled by `priceScale`
     */
    function getPrice(address priceFeed) public view returns (uint) {
        (, int price, , , ) = AggregatorV3Interface(priceFeed).latestRoundData();
        return unsigned256(price);
    }

    /**
     * @dev Whether user has a non-zero balance of an asset, given assetsIn flags
     */
    function isInAsset(uint16 assetsIn, uint8 assetOffset) internal pure returns (bool) {
        return (assetsIn & (uint8(1) << assetOffset) != 0);
    }

    /**
     * @notice Get the i-th asset info, according to the order they were passed in originally
     * @param i The index of the asset info to get
     * @return The asset info object
     */
    function getAssetInfo(uint8 i) public view returns (AssetInfo memory) {
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
        uint rescale = factorScale / 1e4;
        uint64 borrowCollateralFactor = uint64(((word_a >> 160) & type(uint16).max) * rescale);
        uint64 liquidateCollateralFactor = uint64(((word_a >> 176) & type(uint16).max) * rescale);
        uint64 liquidationFactor = uint64(((word_a >> 192) & type(uint16).max) * rescale);

        address priceFeed = address(uint160(word_b & type(uint160).max));
        uint8 decimals = uint8(((word_b >> 160) & type(uint8).max));
        uint64 scale = uint64(10 ** decimals);
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
     * @dev Checks and gets the packed asset info for storage
     */
    function _getPackedAsset(AssetConfig[] memory assetConfigs, uint i) internal view returns (uint256, uint256) {
        AssetConfig memory assetConfig = _getAssetConfig(assetConfigs, i);
        address asset = assetConfig.asset;
        address priceFeed = assetConfig.priceFeed;
        uint8 decimals = assetConfig.decimals;

        // Short-circuit if asset is nil
        if (asset == address(0)) {
            return (0, 0);
        }

        // Sanity check price feed and asset decimals
        require(AggregatorV3Interface(priceFeed).decimals() == priceFeedDecimals, "bad price feed decimals");
        require(ERC20(asset).decimals() == decimals, "asset decimals mismatch");

        // Ensure collateral factors are within range
        require(assetConfig.borrowCollateralFactor < assetConfig.liquidateCollateralFactor, "borrow CF must be < liquidate CF");
        require(assetConfig.liquidateCollateralFactor <= maxCollateralFactor, "liquidate CF too high");

        // Keep 4 decimals for each factor
        uint descale = factorScale / 1e4;
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
     * @dev Multiply a `fromScale` quantity by a price, returning a common price quantity
     */
    function mulPrice(uint n, uint price, uint64 fromScale) internal pure returns (uint) {
        return n * price / fromScale;
    }

    /**
     * @dev Divide a common price quantity by a price, returning a `toScale` quantity
     */
    function divPrice(uint n, uint price, uint64 toScale) internal pure returns (uint) {
        return n * toScale / price;
    }

    /**
     * @dev Write updated balance to store and tracking participation
     */
    function updateBaseBalance(TotalsBasic memory totals, address account, UserBasic memory basic, int104 principalNew) internal {
        int104 principal = basic.principal;
        basic.principal = principalNew;

        if (principal >= 0) {
            uint indexDelta = totals.trackingSupplyIndex - basic.baseTrackingIndex;
            basic.baseTrackingAccrued += safe64(uint104(principal) * indexDelta / baseIndexScale); // XXX decimals
        } else {
            uint indexDelta = totals.trackingBorrowIndex - basic.baseTrackingIndex;
            basic.baseTrackingAccrued += safe64(uint104(-principal) * indexDelta / baseIndexScale); // XXX decimals
        }

        if (principalNew >= 0) {
            basic.baseTrackingIndex = totals.trackingSupplyIndex;
        } else {
            basic.baseTrackingIndex = totals.trackingBorrowIndex;
        }

        userBasic[account] = basic;
    }

    /**
     * @dev The positive principal if positive or the negative principal if negative
     */
    function principalValue(TotalsBasic memory totals, int104 presentValue_) internal pure returns (int104) {
        if (presentValue_ >= 0) {
            return signed104(principalValueSupply(totals, unsigned104(presentValue_)));
        } else {
            return -signed104(principalValueBorrow(totals, unsigned104(-presentValue_)));
        }
    }

    /**
     * @dev The present value projected backward by the supply index
     */
    function principalValueSupply(TotalsBasic memory totals, uint104 presentValue_) internal pure returns (uint104) {
        return uint104(uint(presentValue_) * baseIndexScale / totals.baseSupplyIndex);
    }

    /**
     * @dev The present value projected backwrd by the borrow index
     */
    function principalValueBorrow(TotalsBasic memory totals, uint104 presentValue_) internal pure returns (uint104) {
        return uint104(uint(presentValue_) * baseIndexScale / totals.baseBorrowIndex);
    }

    /**
     * @dev Multiply a signed `fromScale` quantity by a price, returning a common price quantity
     */
    function signedMulPrice(int n, uint price, uint64 fromScale) internal pure returns (int) {
        return n * signed256(price) / signed256(fromScale);
    }

    /**
     * @notice Check whether an account has enough collateral to not be liquidated
     * @param account The address to check
     * @return Whether the account is minimally collateralized enough to not be liquidated
     */
    function isLiquidatable(address account) public view returns (bool) {
        uint16 assetsIn = userBasic[account].assetsIn;
        TotalsBasic memory totals = totalsBasic;

        int liquidity = signedMulPrice(
            presentValue(totals, userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            baseScale
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                if (liquidity >= 0) {
                    return false;
                }

                AssetInfo memory asset = getAssetInfo(i);
                uint newAmount = mulPrice(
                    userCollateral[account][asset.asset].balance,
                    getPrice(asset.priceFeed),
                    asset.scale
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    asset.liquidateCollateralFactor
                ));
            }
        }

        return liquidity < 0;
    }

    /**
     * @return Whether or not buy actions are paused
     */
    function isBuyPaused() public view returns (bool) {
        return toBool(totalsBasic.pauseFlags & (uint8(1) << PAUSE_BUY_OFFSET));
    }

    /**
     * @notice Gets the total amount of protocol reserves, denominated in the number of base tokens
     */
    function getReserves() public view returns (int) {
        TotalsBasic memory totals = totalsBasic;
        uint balance = ERC20(baseToken).balanceOf(address(this));
        uint104 totalSupply = presentValueSupply(totals, totals.totalSupplyBase);
        uint104 totalBorrow = presentValueBorrow(totals, totals.totalBorrowBase);
        return signed256(balance) - signed104(totalSupply) + signed104(totalBorrow);
    }

    /**
     * @dev Safe ERC20 transfer in, assumes no fee is charged and amount is transferred
     */
    function doTransferIn(address asset, address from, uint amount) internal {
        bool success = ERC20(asset).transferFrom(from, address(this), amount);
        require(success, "failed to transfer token in");
    }

    /**
     * @notice Gets the quote for a collateral asset in exchange for an amount of base asset
     * @param asset The collateral asset to get the quote for
     * @param baseAmount The amount of the base asset to get the quote for
     * @return The quote in terms of the collateral asset
     */
    function quoteCollateral(address asset, uint baseAmount) public view returns (uint) {
        // XXX: Add StoreFrontDiscount.
        AssetInfo memory assetInfo = getAssetInfoByAddress(asset);
        uint assetPrice = getPrice(assetInfo.priceFeed);
        uint basePrice = getPrice(baseTokenPriceFeed);
        uint assetWeiPerUnitBase = assetInfo.scale * basePrice / assetPrice;
        return assetWeiPerUnitBase * baseAmount / baseScale;
    }

    /**
     * @dev Determine index of asset that matches given address
     */
    function getAssetInfoByAddress(address asset) internal view returns (AssetInfo memory) {
        for (uint8 i = 0; i < numAssets; i++) {
            AssetInfo memory assetInfo = getAssetInfo(i);
            if (assetInfo.asset == asset) {
                return assetInfo;
            }
        }
        revert("asset not found");
    }

    /**
     * @dev Withdraw an amount of collateral asset from src to `to`
     */
    function withdrawCollateral(address src, address to, address asset, uint128 amount) internal {
        TotalsCollateral memory totals = totalsCollateral[asset];
        totals.totalSupplyAsset -= amount;

        uint128 srcCollateral = userCollateral[src][asset].balance;
        uint128 srcCollateralNew = srcCollateral - amount;

        totalsCollateral[asset] = totals;
        userCollateral[src][asset].balance = srcCollateralNew;

        updateAssetsIn(src, asset, srcCollateral, srcCollateralNew);

        // Note: no accrue interest, BorrowCF < LiquidationCF covers small changes
        require(isBorrowCollateralized(src), "borrow would not be maintained");

        doTransferOut(asset, to, amount);
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
        AssetInfo memory assetInfo = getAssetInfoByAddress(asset);
        if (initialUserBalance == 0 && finalUserBalance != 0) {
            // set bit for asset
            userBasic[account].assetsIn |= (uint8(1) << assetInfo.offset);
        } else if (initialUserBalance != 0 && finalUserBalance == 0) {
            // clear bit for asset
            userBasic[account].assetsIn &= ~(uint8(1) << assetInfo.offset);
        }
    }

    /**
     * @notice Check whether an account has enough collateral to borrow
     * @param account The address to check
     * @return Whether the account is minimally collateralized enough to borrow
     */
    function isBorrowCollateralized(address account) public view returns (bool) {
        // XXX take in UserBasic and UserCollateral as arguments to reduce SLOADs
        uint16 assetsIn = userBasic[account].assetsIn;
        TotalsBasic memory totals = totalsBasic;

        int liquidity = signedMulPrice(
            presentValue(totals, userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            baseScale
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                if (liquidity >= 0) {
                    return true;
                }

                AssetInfo memory asset = getAssetInfo(i);
                uint newAmount = mulPrice(
                    userCollateral[account][asset.asset].balance,
                    getPrice(asset.priceFeed),
                    safe64(asset.scale)
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    asset.borrowCollateralFactor
                ));
            }
        }

        return liquidity >= 0;
    }

    /**
     * @dev Safe ERC20 transfer out
     */
    function doTransferOut(address asset, address to, uint amount) internal {
        bool success = ERC20(asset).transfer(to, amount);
        require(success, "failed to transfer token out");
    }




}