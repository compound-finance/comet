// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometConfiguration.sol";

/**
 * @title Compound's Comet Storage Interface
 * @dev Versions can enforce append-only storage slots via inheritance.
 * @author Compound
 */
contract CometStorage is CometConfiguration {
    
    /// ====== Internal Constants ======

    /// @dev The max number of assets this contract is hardcoded to support
    ///  Do not change this variable without updating all the fields throughout the contract,
    //    including the size of UserBasic.assetsIn and corresponding integer conversions.
    uint8 internal constant MAX_ASSETS = 15;

    /// @dev The max number of decimals base token can have
    ///  Note this cannot just be increased arbitrarily.
    uint8 internal constant MAX_BASE_DECIMALS = 18;

    /// @dev Offsets for specific actions in the pause flag bit array
    uint8 internal constant PAUSE_SUPPLY_OFFSET = 0;
    uint8 internal constant PAUSE_TRANSFER_OFFSET = 1;
    uint8 internal constant PAUSE_WITHDRAW_OFFSET = 2;
    uint8 internal constant PAUSE_ABSORB_OFFSET = 3;
    uint8 internal constant PAUSE_BUY_OFFSET = 4;

    /// @dev The decimals required for a price feed
    uint8 internal constant PRICE_FEED_DECIMALS = 8;

    /// @dev 365 days * 24 hours * 60 minutes * 60 seconds
    uint64 internal constant SECONDS_PER_YEAR = 31_536_000;

    /// @dev The scale for base index (depends on time/rate scales, not base token)
    uint64 internal constant BASE_INDEX_SCALE = 1e15;

    /// @dev The scale for factors
    uint64 internal constant FACTOR_SCALE = 1e18;

    /// @dev The scale for prices (in USD)
    uint64 internal constant PRICE_SCALE = 1e8;

    /// ====== Configurator Parameters ======

    /// @notice Configuration settings used to deploy new Comet instances
    /// by the configurator
    /// @dev This needs to be internal to avoid a `CompilerError: Stack too deep
    /// when compiling inline assembly` error that is caused by the default
    /// getters created for public variables.
    address public governorParam;
    address public pauseGuardianParam;
    address public baseTokenParam;
    address public baseTokenPriceFeedParam;
    address public extensionDelegateParam;

    uint64 public kinkParam;
    uint64 public perYearInterestRateSlopeLowParam;
    uint64 public perYearInterestRateSlopeHighParam;
    uint64 public perYearInterestRateBaseParam;
    uint64 public reserveRateParam;
    uint64 public trackingIndexScaleParam;
    uint64 public baseTrackingSupplySpeedParam;
    uint64 public baseTrackingBorrowSpeedParam;
    uint104 public baseMinForRewardsParam;
    uint104 public baseBorrowMinParam;
    uint104 public targetReservesParam;

    AssetConfig[] public assetConfigsParam;

    /// ====== Comet Storage ======

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

    /// @notice Aggregate variables tracked for the entire market
    TotalsBasic public totalsBasic;

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
}
