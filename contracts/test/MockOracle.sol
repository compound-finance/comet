// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Mock oracle
 * @notice Mock oracle to test the scaling price feed with updated update time
 * @author Compound
 */
contract MockOracle {

    /// @notice Number of decimals for returned prices
    uint8 public immutable decimals;

    /// @notice Underlying Chainlink price feed where prices are fetched from
    address public immutable underlyingPriceFeed;

    /**
     * @notice Construct a new scaling price feed
     * @param underlyingPriceFeed_ The address of the underlying price feed to fetch prices from
     **/
    constructor(address underlyingPriceFeed_) {
        underlyingPriceFeed = underlyingPriceFeed_;
        decimals = AggregatorV3Interface(underlyingPriceFeed_).decimals();
    }

    /**
     * @notice Price for the latest round
     * @return roundId Round id from the underlying price feed
     * @return answer Latest price for the asset in terms of ETH
     * @return startedAt Timestamp when the round was started; passed on from underlying price feed
     * @return updatedAt Current timestamp
     * @return answeredInRound Round id in which the answer was computed; passed on from underlying price feed
     **/
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        (uint80 roundId_, int256 price, uint256 startedAt_, , uint80 answeredInRound_) = AggregatorV3Interface(underlyingPriceFeed).latestRoundData();
        return (roundId_, price, startedAt_, block.timestamp, answeredInRound_);
    }
}
