// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "./CometStorage.sol";
import "./ERC20.sol";
import "./vendor/@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "./vendor/@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Compound's Comet Contract
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
contract Comet is CometStorage, EIP712 {
    /// @notice The name of this contract
    string public constant NAME = "Compound Comet";

    /// @notice The major version of this contract
    string public constant VERSION = "0";

    /// @notice The EIP-712 typehash for allowBySig Authorization
    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256("Authorization(address owner,address manager,bool isAllowed,uint256 nonce,uint256 expiry)");

    struct AssetInfo {
        address asset;
        uint borrowCollateralFactor;
        uint liquidateCollateralFactor;
    }

    struct Configuration {
        address governor;
        address pauseGuardian;
        address priceOracle;
        address baseToken;

        uint64 trackingIndexScale;
        uint72 baseMinForRewards;
        uint64 baseTrackingSupplySpeed;
        uint64 baseTrackingBorrowSpeed;

        AssetInfo[] assetInfo;

        uint64 kink;
        uint64 perYearInterestRateSlopeLow;
        /// @dev Do not set this value higher than 2^64=1.84e19
        uint64 perYearInterestRateSlopeHigh;
        uint64 perYearInterestRateBase;
        uint64 reserveRate;
    }

    /// @notice The number of seconds per year
    /// @dev 365 days * 24 hours * 60 minutes * 60 seconds
    uint64 public constant secondsPerYear = 31_536_000;

    /// @notice The max number of assets this contract is hardcoded to support
    /// @dev Do not change this variable without updating all the fields throughout the contract.
    uint public constant maxAssets = 2;

    /// @notice The number of assets this contract actually supports
    uint public immutable numAssets;

    /// @notice Offsets for specific actions in the pause flag bit array
    uint8 public constant pauseSupplyOffset = 0;
    uint8 public constant pauseTransferOffset = 1;
    uint8 public constant pauseWithdrawOffset = 2;
    uint8 public constant pauseAbsorbOffset = 3;
    uint8 public constant pauseBuyOffset = 4;

    /** General configuration constants **/

    /// @notice The admin of the protocol
    address public immutable governor;

    /// @notice The account which may trigger pauses
    address public immutable pauseGuardian;

    /// @notice The address of the price oracle contract
    address public immutable priceOracle;

    /// @notice The address of the base token contract
    address public immutable baseToken;

    /// @notice The scale for base token (must be less than 18 decimals)
    uint64 public immutable baseScale;

    /// @notice The scale for base index (depends on time/rate scales, not base token)
    uint64 public constant baseIndexScale = 1e15;

    /// @notice The scale for factors
    uint256 public constant factorScale = 1e18;

    /// @notice The scale for reward tracking
    uint64 public immutable trackingIndexScale;

    /// @notice The minimum amount of base wei for rewards to accrue
    /// @dev This must be large enough so as to prevent division by base wei from overflowing the 64 bit indices.
    uint72 public immutable baseMinForRewards;

    /// @notice The speed at which supply rewards are tracked (in trackingIndexScale)
    uint64 public immutable baseTrackingSupplySpeed;

    /// @notice The speed at which borrow rewards are tracked (in trackingIndexScale)
    uint64 public immutable baseTrackingBorrowSpeed;

    /// @notice The point in the supply and borrow rates separating the low interest rate slope and the high interest rate slope
    /// @dev Factor (scale of 1e18)
    uint64 public immutable kink;

    /// @notice Per second interest rate slope applied when utilization is below kink
    /// @dev Factor (scale of 1e18)
    uint64 public immutable perSecondInterestRateSlopeLow;

    /// @notice Per second interest rate slope applied when utilization is above kink
    /// @dev Factor (scale of 1e18)
    uint64 public immutable perSecondInterestRateSlopeHigh;

    /// @notice Per second base interest rate
    /// @dev Factor (scale of 1e18)
    uint64 public immutable perSecondInterestRateBase;

    /// @notice The rate of total interest paid that goes into reserves
    /// @dev Factor (scale of 1e18)
    uint64 public immutable reserveRate;

    /**  Collateral asset configuration **/

    address internal immutable asset00;
    address internal immutable asset01;

    uint internal immutable borrowCollateralFactor00;
    uint internal immutable borrowCollateralFactor01;

    uint internal immutable liquidateCollateralFactor00;
    uint internal immutable liquidateCollateralFactor01;

    /// @notice The next expected nonce for an address, for validating authorizations via signature
    mapping(address => uint) public userNonce;

    /**
     * @notice Construct a new protocol instance
     * @param config The mapping of initial/constant parameters
     **/
    constructor(Configuration memory config) EIP712(NAME, VERSION) {
        // Sanity checks
        uint decimals = ERC20(config.baseToken).decimals();
        require(decimals <= 18, "base token has too many decimals");
        require(config.baseMinForRewards > 0, "baseMinForRewards should be > 0");
        require(config.assetInfo.length <= maxAssets, "too many asset configs");
        // XXX other sanity checks? for rewards?

        // Copy configuration
        governor = config.governor;
        pauseGuardian = config.pauseGuardian;
        priceOracle = config.priceOracle;
        baseToken = config.baseToken;

        baseScale = uint64(10 ** decimals);
        trackingIndexScale = config.trackingIndexScale;

        baseMinForRewards = config.baseMinForRewards;
        baseTrackingSupplySpeed = config.baseTrackingSupplySpeed;
        baseTrackingBorrowSpeed = config.baseTrackingBorrowSpeed;

        // Set asset info
        numAssets = config.assetInfo.length;

        asset00 = _getAsset(config.assetInfo, 0).asset;
        asset01 = _getAsset(config.assetInfo, 1).asset;

        borrowCollateralFactor00 = _getAsset(config.assetInfo, 0).borrowCollateralFactor;
        borrowCollateralFactor01 = _getAsset(config.assetInfo, 1).borrowCollateralFactor;

        liquidateCollateralFactor00 = _getAsset(config.assetInfo, 0).liquidateCollateralFactor;
        liquidateCollateralFactor01 = _getAsset(config.assetInfo, 1).liquidateCollateralFactor;

        // Set interest rate model configs
        kink = config.kink;
        perSecondInterestRateSlopeLow = config.perYearInterestRateSlopeLow / secondsPerYear;
        perSecondInterestRateSlopeHigh = config.perYearInterestRateSlopeHigh / secondsPerYear;
        perSecondInterestRateBase = config.perYearInterestRateBase / secondsPerYear;
        reserveRate = config.reserveRate;

        // Initialize aggregates
        totals.lastAccrualTime = getNow();
        totals.baseSupplyIndex = baseIndexScale;
        totals.baseBorrowIndex = baseIndexScale;
        totals.trackingSupplyIndex = 0;
        totals.trackingBorrowIndex = 0;
    }

    /**
     * @dev XXX (dev for internal)
     */
    function _getAsset(AssetInfo[] memory assetInfo, uint i) internal pure returns (AssetInfo memory) {
        if (i < assetInfo.length)
            return assetInfo[i];
        return AssetInfo({
            asset: address(0),
            borrowCollateralFactor: uint256(0),
            liquidateCollateralFactor: uint256(0)
        });
    }

    /**
     * @notice Get the i-th asset info, according to the order they were passed in originally
     * @param i The index of the asset info to get
     * @return The asset info object
     */
    function getAssetInfo(uint i) public view returns (AssetInfo memory) {
        require(i < numAssets, "asset info not found");

        if (i == 0) return AssetInfo({asset: asset00, borrowCollateralFactor: borrowCollateralFactor00, liquidateCollateralFactor: liquidateCollateralFactor00 });
        if (i == 1) return AssetInfo({asset: asset01, borrowCollateralFactor: borrowCollateralFactor01, liquidateCollateralFactor: liquidateCollateralFactor01 });
        revert("absurd");
    }

    /**
     * @notice XXX
     */
    function assets() public view returns (AssetInfo[] memory) {
        AssetInfo[] memory result = new AssetInfo[](numAssets);

        for (uint i = 0; i < numAssets; i++) {
            result[i] = getAssetInfo(i);
        }

        return result;
    }

    /**
     * @notice XXX
     */
    function assetAddresses() public view returns (address[] memory) {
        address[] memory result = new address[](numAssets);

        for (uint i = 0; i < numAssets; i++) {
            result[i] = getAssetInfo(i).asset;
        }

        return result;
    }

    /**
     * @return The current timestamp
     **/
    function getNow() virtual public view returns (uint40) {
        require(block.timestamp < 2**40, "timestamp exceeds size (40 bits)");
        return uint40(block.timestamp);
    }

    /**
     * @notice Accrue interest (and rewards) in base token supply and borrows
     **/
    function accrue() public {
        totals = accrue(totals);
    }

    /**
     * @notice Accrue interest (and rewards) in base token supply and borrows
     **/
    function accrue(Totals memory totals_) internal view returns (Totals memory) {
        uint40 now_ = getNow();
        uint timeElapsed = now_ - totals_.lastAccrualTime;
        if (timeElapsed > 0) {
            totals_.baseSupplyIndex += safe64(mulFactor(totals_.baseSupplyIndex, getSupplyRate() * timeElapsed));
            totals_.baseBorrowIndex += safe64(mulFactor(totals_.baseBorrowIndex, getBorrowRate() * timeElapsed));
            if (totals_.totalSupplyBase >= baseMinForRewards) {
                totals_.trackingSupplyIndex += safe64(divBaseWei(baseTrackingSupplySpeed * timeElapsed, totals_.totalSupplyBase));
            }
            if (totals_.totalBorrowBase >= baseMinForRewards) {
                totals_.trackingBorrowIndex += safe64(divBaseWei(baseTrackingBorrowSpeed * timeElapsed, totals_.totalBorrowBase));
            }
        }
        totals_.lastAccrualTime = now_;
        return totals_;
    }

    /**
     * @notice XXX
     */
    function allow(address manager, bool _isAllowed) external {
      allowInternal(msg.sender, manager, _isAllowed);
    }

    /**
     * @dev XXX
     */
    function allowInternal(address owner, address manager, bool _isAllowed) internal {
        isAllowed[owner][manager] = _isAllowed;
    }

    /**
     * @notice Sets authorization status for a manager via signature from signatory
     * @param owner The address that signed the signature
     * @param manager The address to authorize (or rescind authorization from)
     * @param isAllowed_ Whether to authorize or rescind authorization from manager
     * @param nonce The next expected nonce value for the signatory
     * @param expiry Expiration time for the signature
     * @param signature EIP-712 signature from signatory authorizing manager
     */
    function allowBySig(
        address owner,
        address manager,
        bool isAllowed_,
        uint256 nonce,
        uint256 expiry,
        bytes memory signature
    ) external {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            AUTHORIZATION_TYPEHASH,
            owner,
            manager,
            isAllowed_,
            nonce,
            expiry
        )));
        address signatory = ECDSA.recover(digest, signature);
        require(owner == signatory, "Signature does not match arguments");
        require(signatory != address(0), "Invalid signature");
        require(nonce == userNonce[signatory], "Invalid nonce");
        require(block.timestamp < expiry, "Signed transaction expired");
        userNonce[signatory]++;
        allowInternal(signatory, manager, isAllowed_);
    }

    /**
     * @return The current per second supply rate
     */
    // TODO: Optimize by passing totals from caller to getUtilization()
    function getSupplyRate() public view returns (uint64) {
        uint utilization = getUtilization();
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
     * @return The current per second borrow rate
     */
    // TODO: Optimize by passing totals from caller to getUtilization()
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
        // TODO: Optimize by passing in totals instead of reading from storage.
        Totals memory totals_ = totals;
        uint totalSupply = presentValueSupply(totals_.totalSupplyBase);
        uint totalBorrow = presentValueBorrow(totals_.totalBorrowBase);
        if (totalSupply == 0) {
            return 0;
        } else {
            return totalBorrow * factorScale / totalSupply;
        }
    }

    /**
     * @return The positive present supply balance if positive or the negative borrow balance if negative
     */
    function presentValue(int104 principalValue) internal view returns (int104) {
        if (principalValue >= 0) {
            return signed104(presentValueSupply(unsigned104(principalValue)));
        } else {
            return -signed104(presentValueBorrow(unsigned104(-principalValue)));
        }
    }

    /**
     * @return The principal amount projected forward by the supply index
     */
    function presentValueSupply(uint104 principalValue) internal view returns (uint104) {
        // TODO: Optimize by passing in index instead of reading from storage.
        return principalValue * totals.baseSupplyIndex;
    }

    /**
     * @return The principal amount projected forward by the borrow index
     */
    function presentValueBorrow(uint104 principalValue) internal view returns (uint104) {
        // TODO: Optimize by passing in index instead of reading from storage.
        return principalValue * totals.baseBorrowIndex;
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
        require(msg.sender == governor || msg.sender == pauseGuardian, "Unauthorized");

        totals.pauseFlags =
            uint8(0) |
            (toUInt8(supplyPaused) << pauseSupplyOffset) |
            (toUInt8(transferPaused) << pauseTransferOffset) |
            (toUInt8(withdrawPaused) << pauseWithdrawOffset) |
            (toUInt8(absorbPaused) << pauseAbsorbOffset) |
            (toUInt8(buyPaused) << pauseBuyOffset);
    }

    /**
     * @return Whether or not supply actions are paused
     */
    function isSupplyPaused() public view returns (bool) {
        return toBool(totals.pauseFlags & (uint8(1) << pauseSupplyOffset));
    }

    /**
     * @return Whether or not transfer actions are paused
     */
    function isTransferPaused() public view returns (bool) {
        return toBool(totals.pauseFlags & (uint8(1) << pauseTransferOffset));
    }

    /**
     * @return Whether or not withdraw actions are paused
     */
    function isWithdrawPaused() public view returns (bool) {
        return toBool(totals.pauseFlags & (uint8(1) << pauseWithdrawOffset));
    }

    /**
     * @return Whether or not absorb actions are paused
     */
    function isAbsorbPaused() public view returns (bool) {
        return toBool(totals.pauseFlags & (uint8(1) << pauseAbsorbOffset));
    }

    /**
     * @return Whether or not buy actions are paused
     */
    function isBuyPaused() public view returns (bool) {
        return toBool(totals.pauseFlags & (uint8(1) << pauseBuyOffset));
    }

    /**
     * @return uint8 representation of the boolean input
     */
    function toUInt8(bool x) internal pure returns (uint8) {
        return x ? 1 : 0;
    }

    /**
     * @return Boolean representation of the uint8 input
     */
    function toBool(uint8 x) internal pure returns (bool) {
        return x != 0;
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
     * @dev Safely cast a number to a 64 bit number
     */
    function safe64(uint n) internal pure returns (uint64) {
        require(n <= type(uint64).max, "number exceeds size (64 bits)");
        return uint64(n);
    }

    /**
     * @dev Safely cast an uint104 to an int104
     */
    function signed104(uint104 n) internal pure returns (int104) {
        require(n <= uint104(type(int104).max), "number exceeds max int size");
        return int104(n);
    }

    /**
     * @dev Safely cast an int104 to an uint104
     */
    function unsigned104(int104 n) internal pure returns (uint104) {
        require(n >= 0, "number is negative");
        return uint104(n);
    }
}
