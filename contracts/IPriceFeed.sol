// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @dev Interface for price feeds used by Comet
 * Note This is Chainlink's AggregatorV3Interface, but without the `getRoundData` function.
 */
interface IPriceFeed {
  function decimals() external view returns (uint8);

  function description() external view returns (string memory);

  function version() external view returns (uint256);

  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
}