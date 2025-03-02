// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceCapAdapterBase
 * @author Compound
 * @notice Price adapter to cap the price of the underlying asset.
 */
abstract contract PriceCapAdapterBase {
  /**
   * @dev Emitted when the cap parameters are updated
   * @param snapshotRatio the ratio at the time of snapshot
   * @param snapshotTimestamp the timestamp at the time of snapshot
   * @param maxRatioGrowthPerSecond max ratio growth per second
   * @param maxYearlyRatioGrowthPercent max yearly ratio growth percent
   **/
  event CapParametersUpdated(
    uint256 snapshotRatio,
    uint256 snapshotTimestamp,
    uint256 maxRatioGrowthPerSecond,
    uint32 maxYearlyRatioGrowthPercent
  );

  /**
   * @notice Parameters to create adapter
   * @param capAdapterParams parameters to create adapter
   */
  struct CapAdapterBaseParams {
    address manager;
    address baseAggregatorAddress;
    address ratioProviderAddress;
    string description;
    uint8 ratioDecimals;
    uint8 priceFeedDecimals;
    uint48 minimumSnapshotDelay;
    PriceCapUpdateParams priceCapParams;
  }

  /**
   * @notice Parameters to create CL cap adapter
   * @param clCapAdapterParams parameters to create CL cap adapter
   */
  struct CapAdapterParams {
    address manager;
    address baseAggregatorAddress;
    address ratioProviderAddress;
    uint8 ratioDecimals;
    uint8 priceFeedDecimals;
    string description;
    uint48 minimumSnapshotDelay;
    PriceCapUpdateParams priceCapParams;
  }

  /**
   * @notice Parameters to update price cap
   * @param priceCapParams parameters to set price cap
   */
  struct PriceCapUpdateParams {
    uint104 snapshotRatio;
    uint48 snapshotTimestamp;
    uint32 maxYearlyRatioGrowthPercent;
  }
  
  error ManagerIsZeroAddress();
  error SnapshotRatioIsZero();
  error SnapshotMayOverflowSoon(uint104 snapshotRatio, uint32 maxYearlyRatioGrowthPercent);
  error InvalidRatioTimestamp(uint48 timestamp);
  error OnlyManager();
  error InvalidInt256();

  /**
   * @notice Maximum percentage factor (100.00%)
   */
  uint256 public constant PERCENTAGE_FACTOR = 1e4;

  /**
   * @notice Minimal time while ratio should not overflow, in years
   */
  uint256 public constant MINIMAL_RATIO_INCREASE_LIFETIME = 3;

  /**
   * @notice Number of seconds per year (365 days)
   */
  uint256 public constant SECONDS_PER_YEAR = 365 days;

  /**
   * @notice Price feed for (ASSET / BASE) pair
   */
  AggregatorV3Interface public immutable ASSET_TO_BASE_AGGREGATOR;

  /**
   * @notice Manager address
   */
  address public manager;

  /**
   * @notice Ratio feed for (LST_ASSET / BASE_ASSET) pair
   */
  address public immutable RATIO_PROVIDER;

  /**
   * @notice Number of decimals in the output of this price adapter
   */
  uint8 public immutable decimals;

  /**
   * @notice Number of decimals for (lst asset / underlying asset) ratio
   */
  uint8 public immutable RATIO_DECIMALS;

  /**
   * @notice Minimum time (in seconds) that should have passed from the snapshot timestamp to the current block.timestamp
   */
  uint48 public immutable MINIMUM_SNAPSHOT_DELAY;

  /**
   * @notice Description of the pair
   */
  string public description;

  /**
   * @notice Ratio at the time of snapshot
   */
  uint104 private _snapshotRatio;

  /**
   * @notice Timestamp at the time of snapshot
   */
  uint48 private _snapshotTimestamp;

  /**
   * @notice Ratio growth per second
   */
  uint104 private _maxRatioGrowthPerSecond;

  /**
   * @notice Max yearly growth percent
   */
  uint32 private _maxYearlyRatioGrowthPercent;

  /// @notice Whether or not the price should be upscaled
  bool internal immutable shouldUpscale;

  /// @notice The amount to upscale or downscale the price by
  int256 internal immutable rescaleFactor;

  /**
   * @param capAdapterBaseParams parameters to create adapter
   */
  constructor(CapAdapterBaseParams memory capAdapterBaseParams) {
    if (address(capAdapterBaseParams.manager) == address(0)) {
      revert ManagerIsZeroAddress();
    }
    manager = capAdapterBaseParams.manager;
    ASSET_TO_BASE_AGGREGATOR = AggregatorV3Interface(capAdapterBaseParams.baseAggregatorAddress);
    RATIO_PROVIDER = capAdapterBaseParams.ratioProviderAddress;
    uint8 underlyingPriceFeedDecimals = ASSET_TO_BASE_AGGREGATOR.decimals();
        // Note: Solidity does not allow setting immutables in if/else statements
        shouldUpscale = underlyingPriceFeedDecimals < capAdapterBaseParams.priceFeedDecimals ? true : false;
        rescaleFactor = (shouldUpscale
            ? signed256(10 ** (capAdapterBaseParams.priceFeedDecimals - underlyingPriceFeedDecimals))
            : signed256(10 ** (underlyingPriceFeedDecimals - capAdapterBaseParams.priceFeedDecimals))
        );
    decimals = capAdapterBaseParams.priceFeedDecimals;
    RATIO_DECIMALS = capAdapterBaseParams.ratioDecimals;
    MINIMUM_SNAPSHOT_DELAY = capAdapterBaseParams.minimumSnapshotDelay;

    description = capAdapterBaseParams.description;

    _setCapParameters(capAdapterBaseParams.priceCapParams);
  }

  /**
   * @notice Returns the latest snapshot ratio
   */  function getSnapshotRatio() external view returns (uint256) {
    return _snapshotRatio;
  }

  /**
   * @notice Returns the latest snapshot timestamp
   */
  function getSnapshotTimestamp() external view returns (uint256) {
    return _snapshotTimestamp;
  }

  /**
   * @notice Returns the max yearly ratio growth
   */
  function getMaxYearlyGrowthRatePercent() external view returns (uint256) {
    return _maxYearlyRatioGrowthPercent;
  }

  /**
   * @notice Returns the max ratio growth per second
   */
  function getMaxRatioGrowthPerSecond() external view returns (uint256) {
    return _maxRatioGrowthPerSecond;
  }

  /**
   * @notice Updates price cap parameters
   * @param priceCapParams parameters to set price cap
   */
  function setCapParameters(PriceCapUpdateParams memory priceCapParams) external {
    if (msg.sender != manager) {
      revert OnlyManager();
    }

    _setCapParameters(priceCapParams);
  }

  function setManager(address newManager) external {
    if (msg.sender != manager) {
      revert OnlyManager();
    }

    manager = newManager;
  }

  /**
     * @notice Price for the latest round
     * @return roundId Round id from the underlying price feed
     * @return answer Latest price for the asset in terms of ETH
     * @return startedAt Timestamp when the round was started; passed on from underlying price feed
     * @return updatedAt Timestamp when the round was last updated; passed on from underlying price feed
     * @return answeredInRound Round id in which the answer was computed; passed on from underlying price feed
     **/
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
    // get the current lst to underlying ratio
    int256 currentRatio = getRatio();
    // get the base price
    (uint80 roundId_, int256 _price, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_) = ASSET_TO_BASE_AGGREGATOR.latestRoundData();

    if (_price <= 0 || currentRatio <= 0) {
        return (roundId_, 0, startedAt_, updatedAt_, answeredInRound_);
    }

    // calculate the ratio based on snapshot ratio and max growth rate
    int256 maxRatio = _getMaxRatio();

    if (maxRatio < currentRatio) {
      currentRatio = maxRatio;
    }

    // calculate the price of the underlying asset
    int256 price = (_price * currentRatio) / int256(10 ** RATIO_DECIMALS);

    return (roundId_, scalePrice(price), startedAt_, updatedAt_, answeredInRound_);
  }

  function scalePrice(int256 price) internal view returns (int256) {
      int256 scaledPrice;
      if (shouldUpscale) {
          scaledPrice = price * rescaleFactor;
      } else {
          scaledPrice = price / rescaleFactor;
      }
      return scaledPrice;
  }

  /**
   * @notice Updates price cap parameters
   * @param priceCapParams parameters to set price cap
   */
  function _setCapParameters(PriceCapUpdateParams memory priceCapParams) internal {
    // if snapshot ratio is 0 then growth will not work as expected
    if (priceCapParams.snapshotRatio == 0) {
      revert SnapshotRatioIsZero();
    }

    // new snapshot timestamp should be gt then stored one, but not gt then timestamp of the current block
    if (
      _snapshotTimestamp >= priceCapParams.snapshotTimestamp ||
      priceCapParams.snapshotTimestamp > block.timestamp - MINIMUM_SNAPSHOT_DELAY
    ) {
      revert InvalidRatioTimestamp(priceCapParams.snapshotTimestamp);
    }
    _snapshotRatio = priceCapParams.snapshotRatio;
    _snapshotTimestamp = priceCapParams.snapshotTimestamp;
    _maxYearlyRatioGrowthPercent = priceCapParams.maxYearlyRatioGrowthPercent;

    _maxRatioGrowthPerSecond = uint104(
      (uint256(priceCapParams.snapshotRatio) * priceCapParams.maxYearlyRatioGrowthPercent) /
        PERCENTAGE_FACTOR /
        SECONDS_PER_YEAR
    );

    // if the ratio on the current growth speed can overflow less then in a MINIMAL_RATIO_INCREASE_LIFETIME years, revert
    if (
      uint256(_snapshotRatio) +
        (_maxRatioGrowthPerSecond * SECONDS_PER_YEAR * MINIMAL_RATIO_INCREASE_LIFETIME) >
      type(uint104).max
    ) {
      revert SnapshotMayOverflowSoon(
        priceCapParams.snapshotRatio,
        priceCapParams.maxYearlyRatioGrowthPercent
      );
    }

    emit CapParametersUpdated(
      priceCapParams.snapshotRatio,
      priceCapParams.snapshotTimestamp,
      _maxRatioGrowthPerSecond,
      priceCapParams.maxYearlyRatioGrowthPercent
    );
  }

  /**
   * @notice Returns the current exchange ratio of lst to the underlying(base) asset
   */
  function getRatio() public view virtual returns (int256);

  /**
   * @notice Returns if the price is currently capped
   */
  function isCapped() public view returns (bool) {
    // get the current lst to underlying ratio
    int256 currentRatio = getRatio();

    // calculate the ratio based on snapshot ratio and max growth rate
    int256 maxRatio = _getMaxRatio();

    return currentRatio > maxRatio;
  }

  function _getMaxRatio() internal view returns (int256) {
    return
      int256(_snapshotRatio + _maxRatioGrowthPerSecond * (block.timestamp - _snapshotTimestamp));
  }

  function signed256(uint256 n) internal pure returns (int256) {
      if (n > uint256(type(int256).max)) revert InvalidInt256();
      return int256(n);
  }
}
