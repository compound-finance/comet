// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometCore.sol";

/**
 * @title Compound's Comet Base Delegate Contract
 * @notice Part of an efficient monolithic money market protocol
 * @author Compound
 */
contract CometBase is CometCore {
    // XXX check effect of explicit sizing again and order of immutables

    /// @notice The number of decimals for wrapped base token
    uint8 public immutable decimals;

    /// @notice The scale for base token (must be less than 18 decimals)
    uint64 public immutable baseScale;

    /// @notice The address of the base token contract
    address public immutable baseToken;

    /// @notice The address of the price feed for the base token
    address public immutable baseTokenPriceFeed;

    /// @notice The scale for reward tracking
    uint64 public immutable trackingIndexScale;

    /// @notice The speed at which supply rewards are tracked (in trackingIndexScale)
    uint64 public immutable baseTrackingSupplySpeed;

    /// @notice The speed at which borrow rewards are tracked (in trackingIndexScale)
    uint64 public immutable baseTrackingBorrowSpeed;

    /// @notice The minimum amount of base wei for rewards to accrue
    /// @dev This must be large enough so as to prevent division by base wei from overflowing the 64 bit indices
    /// @dev uint104
    uint public immutable baseMinForRewards;

    /// @notice The minimum base amount required to initiate a borrow
    /// @dev uint104
    uint public immutable baseBorrowMin;

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

    /**
     * @notice Construct a new base delegate
     * @param config The mapping of initial/constant parameters
     **/
    constructor(BaseConfiguration memory config) {
        // Sanity checks
        uint8 decimals_ = ERC20(config.baseToken).decimals();
        require(decimals_ <= MAX_BASE_DECIMALS, "too many decimals");
        require(config.baseMinForRewards > 0, "bad rewards min");
        require(AggregatorV3Interface(config.baseTokenPriceFeed).decimals() == PRICE_FEED_DECIMALS, "bad decimals");
        // XXX other sanity checks? for rewards?

        // Copy configuration
        decimals = decimals_;
        baseToken = config.baseToken;
        baseTokenPriceFeed = config.baseTokenPriceFeed;
        baseScale = uint64(10 ** decimals_);

        // XXX baseTrackingIndexScale? or remove base prefix for others?
        trackingIndexScale = config.trackingIndexScale;

        baseMinForRewards = config.baseMinForRewards;
        baseTrackingSupplySpeed = config.baseTrackingSupplySpeed;
        baseTrackingBorrowSpeed = config.baseTrackingBorrowSpeed;

        baseBorrowMin = config.baseBorrowMin;

        // Set interest rate model configs
        kink = config.kink;
        perSecondInterestRateSlopeLow = config.perYearInterestRateSlopeLow / SECONDS_PER_YEAR;
        perSecondInterestRateSlopeHigh = config.perYearInterestRateSlopeHigh / SECONDS_PER_YEAR;
        perSecondInterestRateBase = config.perYearInterestRateBase / SECONDS_PER_YEAR;
        reserveRate = config.reserveRate;
    }

    /**
     * @notice Get the config info copied by the protocol
     * @return The base token address, price feed address, and scale
     */
    function getInfo() external view returns (address, address, uint64) {
        return (baseToken, baseTokenPriceFeed, baseScale);
    }

    /**
     * @notice Get the total number of tokens in circulation
     * @return The supply of tokens
     **/
    function totalSupply() external view returns (uint256) {
        return presentValueSupply(baseSupplyIndex, totalSupplyBase);
    }

    /**
     * @notice Query the current positive base balance of an account or zero
     * @param account The account whose balance to query
     * @return The present day base balance magnitude of the account, if positive
     */
    function balanceOf(address account) external view returns (uint256) {
        int104 principal = userBasic[account].principal;
        return principal > 0 ? presentValueSupply(baseSupplyIndex, unsigned104(principal)) : 0;
    }

    /**
     * @notice Query the current negative base balance of an account or zero
     * @param account The account whose balance to query
     * @return The present day base balance magnitude of the account, if negative
     */
    function borrowBalanceOf(address account) external view returns (uint256) {
        int104 principal = userBasic[account].principal;
        return principal < 0 ? presentValueBorrow(baseBorrowIndex, unsigned104(-principal)) : 0;
    }

     /**
      * @notice Query the current base balance of an account
      * @param account The account whose balance to query
      * @return The present day base balance of the account
      */
    function baseBalanceOf(address account) external view returns (int104) {
        return presentValue(userBasic[account].principal);
    }

    /**
     * @notice Query the current collateral balance of an account
     * @param account The account whose balance to query
     * @param asset The collateral asset whi
     * @return The collateral balance of the account
     */
    function collateralBalanceOf(address account, address asset) external view returns (uint128) {
        return userCollateral[account][asset].balance;
    }

    /**
     * @dev Divide a number by an amount of base
     */
    function divBaseWei(uint n, uint baseWei) internal view returns (uint) {
        return n * baseScale / baseWei;
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
     * @notice Accrue interest (and rewards) in base token supply and borrows
     **/
    function accrue() public {
        uint40 now_ = getNow();
        uint timeElapsed = now_ - lastAccrualTime;
        if (timeElapsed > 0) {
            uint supplyRate = getSupplyRateInternal(baseSupplyIndex, baseBorrowIndex, totalSupplyBase, totalBorrowBase);
            uint borrowRate = getBorrowRateInternal(baseSupplyIndex, baseBorrowIndex, totalSupplyBase, totalBorrowBase);
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
        }
        lastAccrualTime = now_;
    }

    // XXX any external fn which modifies state should allow caller to mark as untrusted
    function requireCallerAllowsStateModification() internal view {
        // XXX how do we protect this fn?
        //  if we only call w/ msg.sender != this when its a 'real' call?
        //   so anyone can call it directly to modify their own storage
        //    but if you callcode it we will reject
        //    and comet only callcodes in fallback
        //     so that these sensitive functions will reject
        require(msg.sender != address(this), "disallowed");
    }

    // XXX external
    function repayDebtAndCreditBalance(address account, int104 debt, int104 credit) external {
        // This is a sensitive function which the caller should only call explicitly
        requireCallerAllowsStateModification(); // XXX

        // Forgive user of debt and set their balance to amount credited
        updateBaseBalance(account, userBasic[account], principalValue(credit));

        // Reserves are decreased by increasing total supply and decreasing borrows
        //  the change to reserves is `credit - debt`
        // Note: credit is required be non-negative
        totalSupplyBase += principalValueSupply(baseSupplyIndex, unsigned104(credit));
        // Note: debt is required to be negative
        totalBorrowBase -= principalValueBorrow(baseBorrowIndex, unsigned104(-debt));
    }

    /**
     * @dev Write updated balance to store and tracking participation
     */
    function updateBaseBalance(address account, UserBasic memory basic, int104 principalNew) internal {
        int104 principal = basic.principal;
        basic.principal = principalNew;

        if (principal >= 0) {
            uint indexDelta = trackingSupplyIndex - basic.baseTrackingIndex;
            basic.baseTrackingAccrued += safe64(uint104(principal) * indexDelta / BASE_INDEX_SCALE); // XXX decimals
        } else {
            uint indexDelta = trackingBorrowIndex - basic.baseTrackingIndex;
            basic.baseTrackingAccrued += safe64(uint104(-principal) * indexDelta / BASE_INDEX_SCALE); // XXX decimals
        }

        if (principalNew >= 0) {
            basic.baseTrackingIndex = trackingSupplyIndex;
        } else {
            basic.baseTrackingIndex = trackingBorrowIndex;
        }

        userBasic[account] = basic;
    }

    // XXX add these back properly
    function getSupplyRate() external view returns (uint64) {
        return getSupplyRateInternal(baseSupplyIndex, baseBorrowIndex, totalSupplyBase, totalBorrowBase);
    }

    function getBorrowRate() external view returns (uint64) {
        return getBorrowRateInternal(baseSupplyIndex, baseBorrowIndex, totalSupplyBase, totalBorrowBase);
    }

    function getUtilization() external view returns (uint) {
        return getUtilizationInternal(baseSupplyIndex, baseBorrowIndex, totalSupplyBase, totalBorrowBase);
    }

    /**
     * @dev Calculate current per second supply rate given totals
     */
    function getSupplyRateInternal(uint64 baseSupplyIndex_, uint64 baseBorrowIndex_, uint104 totalSupplyBase_, uint104 totalBorrowBase_) internal view returns (uint64) {
        uint utilization = getUtilizationInternal(baseSupplyIndex_, baseBorrowIndex_, totalSupplyBase_, totalBorrowBase_);
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
     * @dev Calculate current per second borrow rate given totals
     */
    function getBorrowRateInternal(uint64 baseSupplyIndex_, uint64 baseBorrowIndex_, uint104 totalSupplyBase_, uint104 totalBorrowBase_) internal view returns (uint64) {
        uint utilization = getUtilizationInternal(baseSupplyIndex_, baseBorrowIndex_, totalSupplyBase_, totalBorrowBase_);
        if (utilization <= kink) {
            // interestRateBase + interestRateSlopeLow * utilization
            return safe64(perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, utilization));
        } else {
            // interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)
            return safe64(perSecondInterestRateBase + mulFactor(perSecondInterestRateSlopeLow, kink) + mulFactor(perSecondInterestRateSlopeHigh, (utilization - kink)));
        }
    }

    /**
     * @dev Calculate utilization rate of the base asset given totals
     */
    function getUtilizationInternal(uint64 baseSupplyIndex, uint64 baseBorrowIndex, uint104 totalSupplyBase, uint104 totalBorrowBase) internal pure returns (uint) {
        uint totalSupply_ = presentValueSupply(baseSupplyIndex, totalSupplyBase);
        uint totalBorrow_ = presentValueBorrow(baseBorrowIndex, totalBorrowBase);
        if (totalSupply_ == 0) {
            return 0;
        } else {
            return totalBorrow_ * FACTOR_SCALE / totalSupply_;
        }
    }

    /**
     * @dev Supply an amount of base asset from `from` to dst
     */
    function supplyBase(address from, address dst, uint104 amount) external { // XXX
        // This is a sensitive function which the caller should only call explicitly
        requireCallerAllowsStateModification(); // XXX
        doTransferIn(baseToken, from, amount);

        accrue();

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
    }

    /**
     * @dev Transfer an amount of base asset from src to dst, borrowing if possible/necessary
     */
    function transferBase(address src, address dst, uint104 amount) external { // XXX
        // This is a sensitive function which the caller should only call explicitly
        requireCallerAllowsStateModification(); // XXX

        accrue();

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
            require(uint104(-srcBalance) >= baseBorrowMin, "borrow too small");
        }

        emit Transfer(src, dst, amount);
    }

    /**
     * @dev Withdraw an amount of base asset from src to `to`, borrowing if possible/necessary
     */
    function withdrawBase(address src, address to, uint104 amount) external { // XXX
        // This is a sensitive function which the caller should only call explicitly
        requireCallerAllowsStateModification(); // XXX

        accrue();

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
            require(uint104(-srcBalance) >= baseBorrowMin, "borrow too small");
        }

        doTransferOut(baseToken, to, amount);
    }
}