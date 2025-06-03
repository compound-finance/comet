// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceCapAdapterBase
 * @author Compound
 * @notice Price adapter to cap the price of the underlying asset.
 */
abstract contract PriceCapAdapterBase {
  /// @notice Event emitted when a new price cap snapshot is set
  event NewPriceCapSnapshot(
    uint256 indexed snapshotRatio,
    uint256 snapshotTimestamp,
    uint256 indexed maxRatioGrowthPerSecond,
    uint32 indexed maxYearlyRatioGrowthPercent
  );

  /// @notice Event emitted when the manager is updated
  event NewManager(address indexed newManager);

  /// @notice Event emitted when the minimum snapshot delay is updated
  event NewMinimumSnapshotDelay(uint256 indexed newMinimumSnapshotDelay);

  /**
   * @notice Price cap snapshot
   * @param snapshotRatio ratio at the time of snapshot
   * @param snapshotTimestamp timestamp at the time of snapshot
   * @param maxYearlyRatioGrowthPercent max yearly growth percent
   */
  struct PriceCapSnapshot {
    uint256 snapshotRatio;
    uint48 snapshotTimestamp;
    uint32 maxYearlyRatioGrowthPercent;
  }
  
  error ManagerIsZeroAddress();
  error SnapshotRatioIsZero();
  error SnapshotCloseToOverflow(uint256 snapshotRatio, uint32 maxYearlyRatioGrowthPercent);
  error InvalidRatioTimestamp(uint48 timestamp);
  error OnlyManager();
  error InvalidInt256();
  error InvalidCheckpointDuration();
  error InvalidAddress();

  /// @notice Decimal factor for percentage
  uint256 public constant BASIS_POINTS = 1e4;

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
  uint48 public minimumSnapshotDelay;

  /// @notice Description of the pair
  string public description;

  /// @notice Ratio at the time of snapshot
  uint256 public snapshotRatio;

  /// @notice Timestamp at the time of snapshot
  uint48 public snapshotTimestamp;

  /// @notice Ratio growth per second
  uint256 public maxRatioGrowthPerSecond;

  /// @notice Growth ratio scale
  uint256 constant public GROWTH_RATIO_SCALE = 1e10;

  /// @notice Max yearly growth percent
  uint32 public maxYearlyRatioGrowthPercent;

  /// @notice Whether or not the price should be upscaled
  bool internal immutable shouldUpscale;

  /// @notice The amount to upscale or downscale the price by
  int256 internal immutable rescaleFactor;

  /// @notice Timestamp of the last snapshot update
  uint256 public lastSnapshotUpdateTimestamp;

  /**
   * @param _manager address of the manager
   * @param _baseAggregatorAddress address of the base aggregator
   * @param _ratioProviderAddress address of the ratio provider
   * @param _description description of the pair
   * @param _priceFeedDecimals number of decimals for the price feed
   * @param _minimumSnapshotDelay minimum time that should have passed from the snapshot timestamp to the current block.timestamp
   * @param _priceCapSnapshot parameters to set price cap
   */
  constructor(
    address _manager,
    address _baseAggregatorAddress,
    address _ratioProviderAddress,
    string memory _description,
    uint8 _priceFeedDecimals,
    uint48 _minimumSnapshotDelay,
    PriceCapSnapshot memory _priceCapSnapshot
  ) {
    if (_manager == address(0)) {
      revert ManagerIsZeroAddress();
    }
    if(_baseAggregatorAddress == address(0) || _ratioProviderAddress == address(0)) {
      revert InvalidAddress();
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
    ratioDecimals = AggregatorV3Interface(ratioProvider).decimals();
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

  /**
   * @notice Sets the manager address
   * @param newManager address of the new manager
   */
  function setManager(address newManager) external {
    if (msg.sender != manager) {
      revert OnlyManager();
    }

    if(newManager == address(0)) {
      revert ManagerIsZeroAddress();
    }

    manager = newManager;
    emit NewManager(newManager);
  }

  /**
   * @notice Sets the minimum snapshot delay
   * @param newMinimumSnapshotDelay minimum time that should have passed from the snapshot timestamp to the current block.timestamp
   */
  function setMinimumSnapshotDelay(uint48 newMinimumSnapshotDelay) external {
    if (msg.sender != manager) {
      revert OnlyManager();
    }

    minimumSnapshotDelay = newMinimumSnapshotDelay;
    emit NewMinimumSnapshotDelay(newMinimumSnapshotDelay);
  }

  /**
     * @notice Price for the latest round
     * @return roundId Round id from the underlying price feed
     * @return answer Latest price for the asset in terms of the underlying asset
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

    return (roundId_, _scalePrice(price), startedAt_, updatedAt_, answeredInRound_);
  }

  /**
   * @notice Scales the price based on the rescale factor
   * @param price price to scale
   * @return scaled price
   */
  function _scalePrice(int256 price) internal view returns (int256) {
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
    if(msg.sender != manager && lastSnapshotUpdateTimestamp == block.timestamp) return;
    lastSnapshotUpdateTimestamp = block.timestamp;
    // if snapshot ratio is 0 then growth will not work as expected
    if (priceCapParams.snapshotRatio == 0) {
      revert SnapshotRatioIsZero();
    }

    // new snapshot timestamp should be gt than stored one, but not gt than timestamp of the current block
    if (
      snapshotTimestamp > priceCapParams.snapshotTimestamp ||
      (msg.sender != manager && priceCapParams.snapshotTimestamp > block.timestamp - minimumSnapshotDelay)
    ) {
      revert InvalidRatioTimestamp(priceCapParams.snapshotTimestamp);
    }
    snapshotRatio = priceCapParams.snapshotRatio;
    snapshotTimestamp = priceCapParams.snapshotTimestamp;
    maxYearlyRatioGrowthPercent = priceCapParams.maxYearlyRatioGrowthPercent;

    maxRatioGrowthPerSecond =
      (uint256(priceCapParams.snapshotRatio) * priceCapParams.maxYearlyRatioGrowthPercent * GROWTH_RATIO_SCALE) /
        BASIS_POINTS /
        SECONDS_PER_YEAR;

    // if the ratio on the current growth speed can overflow less than in a 3 years, revert
    if (
      uint256(snapshotRatio) +
        uint256(maxRatioGrowthPerSecond * SECONDS_PER_YEAR * 3) / GROWTH_RATIO_SCALE >
      type(uint128).max
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

  /// @notice Returns the maximum ratio that can be achieved at the current block.timestamp
  function _getMaxRatio() internal view returns (int256) {
    return
      int256(snapshotRatio + maxRatioGrowthPerSecond * (block.timestamp - snapshotTimestamp) / GROWTH_RATIO_SCALE);
  }

  function signed256(uint256 n) internal pure returns (int256) {
    if (n > uint256(type(int256).max)) revert InvalidInt256();
    return int256(n);
  }
}
