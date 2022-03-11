// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

/**
 * @title Compound's Comet Storage Interface
 * @dev Versions can enforce append-only storage slots via inheritance.
 * @author Compound
 */
contract CometStorage {
    // 512 bits total = 2 slots
    struct TotalsBasic {
        // 1st slot
        uint64 baseSupplyIndex;
        uint64 baseBorrowIndex;
        uint64 trackingSupplyIndex;
        uint64 trackingBorrowIndex;
        // 2nd slot
        uint104 totalSupplyBase;
        uint104 totalBorrowBase;
        uint40 lastAccrualTime;
        uint8 pauseFlags;
    }

    struct TotalsCollateral {
        uint128 totalSupplyAsset;
        uint128 _reserved;
    }

    struct UserBasic {
        int104 principal;
        uint64 baseTrackingIndex;
        uint64 baseTrackingAccrued;
        uint16 assetsIn;
        uint8 _reserved;
    }

    struct UserCollateral {
        uint128 balance;
        uint128 _reserved;
    }

    struct LiquidatorPoints {
        uint32 numAbsorbs;
        uint64 numAbsorbed;
        uint128 approxSpend;
        uint32 _reserved;
    }

    /// @dev Aggregate variables tracked for the entire market
    uint64 internal baseSupplyIndex;
    uint64 internal baseBorrowIndex;
    uint64 internal trackingSupplyIndex;
    uint64 internal trackingBorrowIndex;
    uint104 internal totalSupplyBase;
    uint104 internal totalBorrowBase;
    uint40 internal lastAccrualTime;
    uint8 internal pauseFlags;

    /// @notice Aggregate variables tracked for each collateral asset
    mapping(address => TotalsCollateral) public totalsCollateral;

    /// @notice Mapping of users to accounts which may be permitted to manage the user account
    mapping(address => mapping(address => bool)) public isAllowed;

    /// @notice The next expected nonce for an address, for validating authorizations via signature
    mapping(address => uint) public userNonce;

    /// @notice Mapping of users to base principal and other basic data
    mapping(address => UserBasic) public userBasic;

    /// @notice Mapping of users to collateral data per collateral asset
    mapping(address => mapping(address => UserCollateral)) public userCollateral;

    /// @notice Mapping of magic liquidator points
    mapping(address => LiquidatorPoints) public liquidatorPoints;

    // XXX
    uint8 public numAssets;
    mapping(address => uint8) public assetOffset;
    mapping(uint8 => address) public assetAddress;
    mapping(uint8 => address) public assetPriceFeed;
    mapping(uint8 => uint64) public assetScale;
    mapping(uint8 => uint64) public assetBorrowCollateralFactor;
    mapping(uint8 => uint64) public assetLiquidateCollateralFactor;
    mapping(uint8 => uint64) public assetLiquidationFactor;
    mapping(uint8 => uint128) public assetSupplyCap;

    /// @notice The point in the supply and borrow rates separating the low interest rate slope and the high interest rate slope (factor)
    /// @dev uint64
    uint public kink;

    /// @notice Per second interest rate slope applied when utilization is below kink (factor)
    /// @dev uint64
    uint public perSecondInterestRateSlopeLow;

    /// @notice Per second interest rate slope applied when utilization is above kink (factor)
    /// @dev uint64
    uint public perSecondInterestRateSlopeHigh;

    /// @notice Per second base interest rate (factor)
    /// @dev uint64
    uint public perSecondInterestRateBase;

    /// @notice The rate of total interest paid that goes into reserves (factor)
    /// @dev uint64
    uint public reserveRate;

    /// @notice The fraction of actual price to charge for liquidated collateral
    /// @dev uint64
    uint public storeFrontPriceFactor;

    /// @notice The minimum base token reserves which must be held before collateral is hodled
    /// @dev uint104
    uint public targetReserves;

    /// @notice The speed at which supply rewards are tracked (in trackingIndexScale)
    /// @dev uint64
    uint public baseTrackingSupplySpeed;

    /// @notice The speed at which borrow rewards are tracked (in trackingIndexScale)
    /// @dev uint64
    uint public baseTrackingBorrowSpeed;

    /// @notice The minimum amount of base wei for rewards to accrue
    /// @dev This must be large enough so as to prevent division by base wei from overflowing the 64 bit indices
    /// @dev uint104
    uint public baseMinForRewards;

    /// @notice The minimum base amount required to initiate a borrow
    /// @dev uint104
    uint public baseBorrowMin;

}
