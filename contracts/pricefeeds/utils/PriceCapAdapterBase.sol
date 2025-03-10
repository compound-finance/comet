// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceCapAdapterBase
 * @author Compound
 * @notice Price adapter to cap the price of the underlying asset.
 */
abstract contract PriceCapAdapterBase {
  event NewPriceCapSnapshot(
    uint256 indexed snapshotRatio,
    uint256 snapshotTimestamp,
    uint256 indexed maxRatioGrowthPerSecond,
    uint32 indexed maxYearlyRatioGrowthPercent
  );

  /**
   * @notice Price cap snapshot
   * @param snapshotRatio ratio at the time of snapshot
   * @param snapshotTimestamp timestamp at the time of snapshot
   * @param maxYearlyRatioGrowthPercent max yearly growth percent
   */
  struct PriceCapSnapshot {
    uint104 snapshotRatio;
    uint48 snapshotTimestamp;
    uint32 maxYearlyRatioGrowthPercent;
  }
  
  error ManagerIsZeroAddress();
  error SnapshotRatioIsZero();
  error SnapshotCloseToOverflow(uint104 snapshotRatio, uint32 maxYearlyRatioGrowthPercent);
  error InvalidRatioTimestamp(uint48 timestamp);
  error OnlyManager();
  error InvalidInt256();

  /// @notice Decimal factor for percentage
  uint256 public constant PERCENTAGE_DECIMALS = 1e2;

  /// @notice Number of seconds per year (365 days)
  uint256 public constant SECONDS_PER_YEAR = 365 days;

  /// @notice Price feed for (ASSET / BASE) pair
  AggregatorV3Interface public immutable assetToBaseAggregator;

  /// @notice Manager address
  address public manager;

  /// @notice Ratio feed for (LST_ASSET / BASE_ASSET) pair
  address public immutable ratioProvider;

  /// @notice Number of decimals in the output of this price feed
  uint8 public immutable decimals;

  /// @notice Number of decimals for (lst asset / underlying asset) ratio
  uint8 public immutable ratioDecimals;

  /// @notice Minimum time (in seconds) that should have passed from the snapshot timestamp to the current block.timestamp
  uint48 public immutable minimumSnapshotDelay;

  /// @notice Description of the pair
  string public description;

  /// @notice Ratio at the time of snapshot
  uint104 public snapshotRatio;

  /// @notice Timestamp at the time of snapshot
  uint48 public snapshotTimestamp;

  /// @notice Ratio growth per second
  uint104 public maxRatioGrowthPerSecond;

  /// @notice Max yearly growth percent
  uint32 public maxYearlyRatioGrowthPercent;

  /// @notice Whether or not the price should be upscaled
  bool internal immutable shouldUpscale;

  /// @notice The amount to upscale or downscale the price by
  int256 internal immutable rescaleFactor;

  /**
   * @param _manager address of the manager
   * @param _baseAggregatorAddress address of the base aggregator
   * @param _ratioProviderAddress address of the ratio provider
   * @param _description description of the pair
   * @param _ratioDecimals number of decimals for the ratio
   * @param _priceFeedDecimals number of decimals for the price feed
   * @param _minimumSnapshotDelay minimum time that should have passed from the snapshot timestamp to the current block.timestamp
   * @param _priceCapSnapshot parameters to set price cap
   */
  constructor(
    address _manager,
    address _baseAggregatorAddress,
    address _ratioProviderAddress,
    string memory _description,
    uint8 _ratioDecimals,
    uint8 _priceFeedDecimals,
    uint48 _minimumSnapshotDelay,
    PriceCapSnapshot memory _priceCapSnapshot
  ) {
    if (_manager == address(0)) {
      revert ManagerIsZeroAddress();
    }
    manager = _manager;
    assetToBaseAggregator = AggregatorV3Interface(_baseAggregatorAddress);
    ratioProvider = _ratioProviderAddress;
    uint8 underlyingPriceFeedDecimals = assetToBaseAggregator.decimals();
        // Note: Solidity does not allow setting immutables in if/else statements
        shouldUpscale = underlyingPriceFeedDecimals < _priceFeedDecimals ? true : false;
        rescaleFactor = (shouldUpscale
            ? signed256(10 ** (_priceFeedDecimals - underlyingPriceFeedDecimals))
            : signed256(10 ** (underlyingPriceFeedDecimals - _priceFeedDecimals))
        );
    decimals = _priceFeedDecimals;
    ratioDecimals = _ratioDecimals;
    minimumSnapshotDelay = _minimumSnapshotDelay;

    description = _description;

    _setSnapshot(_priceCapSnapshot);
  }

  /**
   * @notice Updates price cap parameters
   * @param priceCapParams parameters to set price cap
   */
  function updateSnapshot(PriceCapSnapshot memory priceCapParams) external {
    if (msg.sender != manager) {
      revert OnlyManager();
    }

    _setSnapshot(priceCapParams);
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

    int256 currentRatio = getRatio();
    (
      uint80 roundId_,
      int256 _price,
      uint256 startedAt_,
      uint256 updatedAt_,
      uint80 answeredInRound_
    ) = assetToBaseAggregator.latestRoundData();

    if (_price <= 0 || currentRatio <= 0) {
        return (roundId_, 0, startedAt_, updatedAt_, answeredInRound_);
    }

    int256 maxRatio = _getMaxRatio();

    if (maxRatio < currentRatio) {
      currentRatio = maxRatio;
    }

    int256 price = (_price * currentRatio) / int256(10 ** ratioDecimals);

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
   * @notice Updates price cap parameters from recent snapshot
   * @param priceCapParams parameters to set price cap
   */
  function _setSnapshot(PriceCapSnapshot memory priceCapParams) internal {
    // if snapshot ratio is 0 then growth will not work as expected
    if (priceCapParams.snapshotRatio == 0) {
      revert SnapshotRatioIsZero();
    }

    // new snapshot timestamp should be gt then stored one, but not gt then timestamp of the current block
    if (
      snapshotTimestamp >= priceCapParams.snapshotTimestamp ||
      priceCapParams.snapshotTimestamp > block.timestamp - minimumSnapshotDelay
    ) {
      revert InvalidRatioTimestamp(priceCapParams.snapshotTimestamp);
    }
    snapshotRatio = priceCapParams.snapshotRatio;
    snapshotTimestamp = priceCapParams.snapshotTimestamp;
    maxYearlyRatioGrowthPercent = priceCapParams.maxYearlyRatioGrowthPercent;

    maxRatioGrowthPerSecond = uint104(
      (uint256(priceCapParams.snapshotRatio) * priceCapParams.maxYearlyRatioGrowthPercent) /
        (100 * PERCENTAGE_DECIMALS) /
        SECONDS_PER_YEAR
    );

    // if the ratio on the current growth speed can overflow less then in a 3 years, revert
    if (
      uint256(snapshotRatio) +
        (maxRatioGrowthPerSecond * SECONDS_PER_YEAR * 3) >
      type(uint104).max
    ) {
      revert SnapshotCloseToOverflow(
        priceCapParams.snapshotRatio,
        priceCapParams.maxYearlyRatioGrowthPercent
      );
    }

    emit NewPriceCapSnapshot(
      priceCapParams.snapshotRatio,
      priceCapParams.snapshotTimestamp,
      maxRatioGrowthPerSecond,
      priceCapParams.maxYearlyRatioGrowthPercent
    );
  }

  /// @notice Returns the current exchange ratio of lst to the underlying(base) asset
  function getRatio() public view virtual returns (int256);

  /// @notice Returns if the price is currently capped
  function isCapped() public view returns (bool) {
    return getRatio() > _getMaxRatio();
  }

  function _getMaxRatio() internal view returns (int256) {
    return
      int256(snapshotRatio + maxRatioGrowthPerSecond * (block.timestamp - snapshotTimestamp));
  }

  function signed256(uint256 n) internal pure returns (int256) {
      if (n > uint256(type(int256).max)) revert InvalidInt256();
      return int256(n);
  }
}
