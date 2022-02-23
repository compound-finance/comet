// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometCore.sol";

import "./vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Compound's Comet Contract
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
contract Comet is CometCore {
    /// @notice The admin of the protocol
    address public immutable governor;

    /// @notice The account which may trigger pauses
    address public immutable pauseGuardian;

    /// @notice The address of the collateral contract delegate
    address public immutable collateralDelegate;

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

    /// @notice The minimum base token reserves which must be held before collateral is hodled
    uint104 public immutable targetReserves;

    /** Internal constants **/

    /// @dev The EIP-712 typehash for the contract's domain
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev The EIP-712 typehash for allowBySig Authorization
    bytes32 internal constant AUTHORIZATION_TYPEHASH = keccak256("Authorization(address owner,address manager,bool isAllowed,uint256 nonce,uint256 expiry)");

    /// @dev The highest valid value for s in an ECDSA signature pair (0 < s < secp256k1n ÷ 2 + 1)
    ///  See https://ethereum.github.io/yellowpaper/paper.pdf #307)
    uint internal constant MAX_VALID_ECDSA_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /**
     * @notice Construct a new protocol instance
     * @param config The mapping of initial/constant parameters
     **/
    constructor(Configuration memory config) {
        // Sanity checks
        uint8 decimals_ = ERC20(config.baseToken).decimals();
        require(decimals_ <= MAX_BASE_DECIMALS, "too many decimals");
        require(config.baseMinForRewards > 0, "bad rewards min");
        require(AggregatorV3Interface(config.baseTokenPriceFeed).decimals() == PRICE_FEED_DECIMALS, "bad decimals");
        // XXX other sanity checks? for rewards?

        // Set governor and pause guardian
        governor = config.governor;
        pauseGuardian = config.pauseGuardian;
        collateralDelegate = config.collateralDelegate;

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

        // Set target reserves
        targetReserves = config.targetReserves;

        // Initialize storage
        initialize_storage();
    }

    /**
     * @notice Initialize storage for the contract
     * @dev Can be used from constructor or proxy
     */
    function initialize_storage() public {
        require(lastAccrualTime == 0, "re-init");

        // Initialize aggregates
        lastAccrualTime = getNow();
        baseSupplyIndex = BASE_INDEX_SCALE;
        baseBorrowIndex = BASE_INDEX_SCALE;
        trackingSupplyIndex = 0;
        trackingBorrowIndex = 0;
    }

    /**
     * @return The current timestamp
     **/
    function getNow() virtual internal view returns (uint40) {
        require(block.timestamp < 2**40, "timestamp too big");
        return uint40(block.timestamp);
    }

    // XXX quadruple check this scheme
    function collatDo(bytes memory calldata_) internal returns (bytes memory returndata) {
        bool success;
        (success, returndata) = collateralDelegate.delegatecall(calldata_);
        if (!success) {
            if (returndata.length == 0) revert();
            assembly { revert(add(32, returndata), mload(returndata)) }
        }
    }

    /**
     * @notice Check whether an account has enough collateral to borrow
     * @param account The address to check
     * @return Whether the account is minimally collateralized enough to borrow
     */
    function isBorrowCollateralized(address account) public returns (bool) {
        int liquidity = signedMulPrice(
            presentValue(userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            baseScale
        );
        int slack = abi.decode(collatDo(abi.encodeWithSignature("getLiquidity(address,uint16,int,bool)", account, userBasic[account].assetsIn, liquidity, true)), (int));
        return slack >= 0;
    }

    /**
     * @notice Check whether an account has enough collateral to not be liquidated
     * @param account The address to check
     * @return Whether the account is minimally collateralized enough to not be liquidated
     */
    function isLiquidatable(address account) public returns (bool) {
        int liquidity = signedMulPrice(
            presentValue(userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            baseScale
        );
        int slack = abi.decode(collatDo(abi.encodeWithSignature("getLiquidity(address,uint16,int,bool)", account, userBasic[account].assetsIn, liquidity, true)), (int));
        return slack < 0;
    }

    /**
     * @return Whether or not supply actions are paused
     */
    function isSupplyPausedInternal() internal view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_SUPPLY_OFFSET));
    }

    /**
     * @return Whether or not transfer actions are paused
     */
    function isTransferPausedInternal() internal view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_TRANSFER_OFFSET));
    }

    /**
     * @return Whether or not withdraw actions are paused
     */
    function isWithdrawPausedInternal() internal view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_WITHDRAW_OFFSET));
    }

    /**
     * @return Whether or not absorb actions are paused
     */
    function isAbsorbPausedInternal() internal view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_ABSORB_OFFSET));
    }

    /**
     * @return Whether or not buy actions are paused
     */
    function isBuyPausedInternal() internal view returns (bool) {
        return toBool(pauseFlags & (uint8(1) << PAUSE_BUY_OFFSET));
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

    /**
      * @notice Approve or disallow `spender` to transfer on sender's behalf
      * @param spender The address of the account which may transfer tokens
      * @param amount Either uint.max (to allow) or zero (to disallow)
      * @return Whether or not the approval change succeeded
      */
    function approve(address spender, uint256 amount) external returns (bool) {
        if (amount == type(uint256).max) {
            allowInternal(msg.sender, spender, true);
        } else if (amount == 0) {
            allowInternal(msg.sender, spender, false);
        } else {
            revert("bad approval amount");
        }
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
      * @notice Get the current allowance from `owner` for `spender`
      * @param owner The address of the account which owns the tokens to be spent
      * @param spender The address of the account which may transfer tokens
      * @return Either uint.max (spender is allowed) or zero (spender is disallowed)
      */
    function allowance(address owner, address spender) external view returns (uint256) {
        return hasPermission(owner, spender) ? type(uint256).max : 0;
    }

    /**
     * @notice Allow or disallow another address to withdraw, or transfer from the sender
     * @param manager The account which will be allowed or disallowed
     * @param isAllowed_ Whether to allow or disallow
     */
    function allow(address manager, bool isAllowed_) external {
        allowInternal(msg.sender, manager, isAllowed_);
    }

    /**
     * @dev Stores the flag marking whether the manager is allowed to act on behalf of owner
     */
    function allowInternal(address owner, address manager, bool isAllowed_) internal {
        isAllowed[owner][manager] = isAllowed_;
    }

    /**
     * @notice Sets authorization status for a manager via signature from signatory
     * @param owner The address that signed the signature
     * @param manager The address to authorize (or rescind authorization from)
     * @param isAllowed_ Whether to authorize or rescind authorization from manager
     * @param nonce The next expected nonce value for the signatory
     * @param expiry Expiration time for the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function allowBySig(
        address owner,
        address manager,
        bool isAllowed_,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(uint256(s) <= MAX_VALID_ECDSA_S, "invalid value: s");
        // v ∈ {27, 28} (source: https://ethereum.github.io/yellowpaper/paper.pdf #308)
        require(v == 27 || v == 28, "invalid value: v");
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), block.chainid, address(this)));
        bytes32 structHash = keccak256(abi.encode(AUTHORIZATION_TYPEHASH, owner, manager, isAllowed_, nonce, expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signatory = ecrecover(digest, v, r, s);
        require(owner == signatory, "owner is not signatory");
        require(nonce == userNonce[signatory]++, "invalid nonce");
        require(block.timestamp < expiry, "signed transaction expired");
        allowInternal(signatory, manager, isAllowed_);
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
        require(msg.sender == governor || msg.sender == pauseGuardian, "bad auth");

        pauseFlags =
            uint8(0) |
            (toUInt8(supplyPaused) << PAUSE_SUPPLY_OFFSET) |
            (toUInt8(transferPaused) << PAUSE_TRANSFER_OFFSET) |
            (toUInt8(withdrawPaused) << PAUSE_WITHDRAW_OFFSET) |
            (toUInt8(absorbPaused) << PAUSE_ABSORB_OFFSET) |
            (toUInt8(buyPaused) << PAUSE_BUY_OFFSET);
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
        require(!isSupplyPausedInternal(), "paused");
        require(hasPermission(from, operator), "bad auth");

        if (asset == baseToken) {
            supplyBase(from, dst, safe104(amount));
        } else {
            collatDo(abi.encodeWithSignature("supplyCollateral(address,address,address,uint128)", from , dst, asset, safe128(amount)));
        }
    }

    /**
     * @dev Supply an amount of base asset from `from` to dst
     */
    function supplyBase(address from, address dst, uint104 amount) internal {
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
        require(!isTransferPausedInternal(), "paused");
        require(hasPermission(src, operator), "bad auth");
        require(src != dst, "no self-transfer");

        if (asset == baseToken) {
            transferBase(src, dst, safe104(amount));
        } else {
            collatDo(abi.encodeWithSignature("transferCollateral(address,address,address,uint128)", src , dst, asset, safe128(amount)));
            // Note: no accrue interest, BorrowCF < LiquidationCF covers small changes
            require(isBorrowCollateralized(src), "bad borrow");
        }
    }

    /**
     * @dev Transfer an amount of base asset from src to dst, borrowing if possible/necessary
     */
    function transferBase(address src, address dst, uint104 amount) internal {
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
            require(isBorrowCollateralized(src), "bad borrow");
        }

        emit Transfer(src, dst, amount);
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
        require(!isWithdrawPausedInternal(), "paused");
        require(hasPermission(src, operator), "bad auth");

        if (asset == baseToken) {
            withdrawBase(src, to, safe104(amount));
        } else {
            collatDo(abi.encodeWithSignature("withdrawCollateral(address,address,address,uint128)", src, to, asset, safe128(amount)));
            // Note: no accrue interest, BorrowCF < LiquidationCF covers small changes
            require(isBorrowCollateralized(src), "bad borrow");
        }
    }

    /**
     * @dev Withdraw an amount of base asset from src to `to`, borrowing if possible/necessary
     */
    function withdrawBase(address src, address to, uint104 amount) internal {
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
            require(isBorrowCollateralized(src), "bad borrow");
        }

        doTransferOut(baseToken, to, amount);
    }

    /**
     * @notice Absorb a list of underwater accounts onto the protocol balance sheet
     * @param absorber The recipient of the incentive paid to the caller of absorb
     * @param accounts The list of underwater accounts to absorb
     */
    function absorb(address absorber, address[] calldata accounts) external {
        require(!isAbsorbPausedInternal(), "paused");

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
     * @dev Transfer user's collateral and debt to the protocol itself
     */
    function absorbInternal(address account) internal {
        accrue();

        require(isLiquidatable(account), "not underwater");

        UserBasic memory accountUser = userBasic[account];

        uint deltaValue = abi.decode(collatDo(abi.encodeWithSignature("seizeAndGetValue(address,uint16)", account, accountUser.assetsIn)), (uint));

        uint128 basePrice = getPrice(baseTokenPriceFeed);
        uint104 deltaBalance = safe104(divPrice(deltaValue, basePrice, baseScale));
        int104 oldBalance = presentValue(accountUser.principal);
        int104 newBalance = oldBalance + signed104(deltaBalance);
        // New balance will not be negative, all excess debt absorbed by reserves
        newBalance = newBalance < 0 ? int104(0) : newBalance;

        // Reserves are decreased by increasing total supply and decreasing borrows
        //  the change to reserves is `newBalance - oldBalance`

        // Forgive user of debt and set their balance to amount credited
        updateBaseBalance(account, userBasic[account], principalValue(newBalance));

        // Note: newBalance is required be non-negative
        totalSupplyBase += principalValueSupply(baseSupplyIndex, unsigned104(newBalance));
        // Note: oldBalance is required to be negative
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
        require(!isBuyPausedInternal(), "paused");

        // Calculate base reserves and compare to the governance set target amount
        int reserves = getReserves();
        require(reserves < 0 || uint(reserves) < targetReserves, "not for sale");

        // XXX check re-entrancy
        doTransferIn(baseToken, msg.sender, baseAmount);

        uint collateralAmount = quoteCollateral(asset, baseAmount);
        require(collateralAmount >= minAmount, "too much slippage");

        collatDo(abi.encodeWithSignature("withdrawCollateral(address,address,address,uint128)", address(this), recipient, asset, safe128(collateralAmount)));
    }

    /**
     * @notice Gets the quote for a collateral asset in exchange for an amount of base asset
     * @param asset The collateral asset to get the quote for
     * @param baseAmount The amount of the base asset to get the quote for
     * @return The quote in terms of the collateral asset
     */
    function quoteCollateral(address asset, uint baseAmount) public returns (uint) {
        // XXX: Add StoreFrontDiscount.
        uint128 basePrice = getPrice(baseTokenPriceFeed);
        return abi.decode(collatDo(abi.encodeWithSignature("getAssetAmount(address,uint,uint128,uint64)", asset, baseAmount, basePrice, baseScale)), (uint));
    }

    /**
     * @notice Gets the total amount of protocol reserves, denominated in the number of base tokens
     */
    function getReserves() public view returns (int) {
        uint balance = ERC20(baseToken).balanceOf(address(this));
        uint104 totalSupply_ = presentValueSupply(baseSupplyIndex, totalSupplyBase);
        uint104 totalBorrow_ = presentValueBorrow(baseBorrowIndex, totalBorrowBase);
        return signed256(balance) - signed104(totalSupply_) + signed104(totalBorrow_);
    }

    /**
     * @notice Withdraws base token reserves if called by the governor
     * @param to An address of the receiver of withdrawn reserves
     * @param amount The amount of reserves to be withdrawn from the protocol
     */
    function withdrawReserves(address to, uint amount) external {
        require(msg.sender == governor, "bad auth");
        require(amount <= unsigned256(getReserves()), "bad amount");
        doTransferOut(baseToken, to, amount);
    }

    /**
     * @notice Fallback to calling the base delegate for everything else
     */
    fallback() external payable {
        // XXX we cant just fallback if the base delegate contains sensitive functions
        //  in particular, it needs external repayDebtAndCreditBalance
        //   which is safe since only we can call it to modify our own storage
        //    as long as only we can call it to modify our own storage
        //    so maybe we can callcode here instead
        //     and the delegate only executes sensitive code if sender is *not* this?
        // XXX also better way to write this?
        address delegate = collateralDelegate;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := callcode(gas(), delegate, 0, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
