// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "./CometStorage.sol";
import "./ERC20.sol";

/**
 * @title Compound's Comet Contract
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
contract Comet is CometStorage {
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
    }

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

    /**  Collateral asset configuration **/

    address internal immutable asset00;
    address internal immutable asset01;

    uint internal immutable borrowCollateralFactor00;
    uint internal immutable borrowCollateralFactor01;

    uint internal immutable liquidateCollateralFactor00;
    uint internal immutable liquidateCollateralFactor01;

    /**
     * @notice Construct a new protocol instance
     * @param config The mapping of initial/constant parameters
     **/
    constructor(Configuration memory config) {
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
     * @return The current supply rate
     **/
    function getSupplyRate() virtual public view returns (uint64) {
        return uint64(factorScale * 20 / 10000000); // XXX
    }

    /**
     * @return The current supply rate
     **/
    function getBorrowRate() virtual public view returns (uint64) {
        return uint64(factorScale * 20 / 10000000); // XXX
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
        require(n < 2**64, "number exceeds size (64 bits)");
        return uint64(n);
    }
}
