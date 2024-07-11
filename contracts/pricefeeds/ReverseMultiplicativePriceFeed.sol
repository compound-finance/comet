// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../IPriceFeed.sol";

/**
 * @title Reverse multiplicative price feed
 * @notice A custom price feed that multiplies the price from one price feed and the inverse price from another price feed and returns the result
 * @dev for example if we need tokenX to eth, but there is only tokenX to usd, we can use this price feed to get tokenX to eth: tokenX to usd * reversed(eth to usd)
 * @author Compound
 */
contract ReverseMultiplicativePriceFeed is IPriceFeed {
    /** Custom errors **/
    error BadDecimals();
    error InvalidInt256();

    /// @notice Version of the price feed
    uint public constant VERSION = 1;

    /// @notice Description of the price feed
    string public override description;

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice Chainlink price feed A
    address public immutable priceFeedA;

    /// @notice Chainlink price feed B
    address public immutable priceFeedB;

    /// @notice Price feed A scale
    int public immutable priceFeedAScale;

    /// @notice Price feed B scale
    int public immutable priceFeedBScale;

    /// @notice Scale of this price feed
    int public immutable priceFeedScale;

    /**
     * @notice Construct a new reverse multiplicative price feed
     * @param priceFeedA_ The address of the first price feed to fetch prices from
     * @param priceFeedB_ The address of the second price feed to fetch prices from that should be reversed
     * @param decimals_ The number of decimals for the returned prices
     * @param description_ The description of the price feed
     **/
    constructor(address priceFeedA_, address priceFeedB_, uint8 decimals_, string memory description_) {
        priceFeedA = priceFeedA_;
        priceFeedB = priceFeedB_;
        uint8 priceFeedADecimals = AggregatorV3Interface(priceFeedA_).decimals();
        uint8 priceFeedBDecimals = AggregatorV3Interface(priceFeedB_).decimals();
        priceFeedAScale = signed256(10 ** (priceFeedADecimals));
        priceFeedBScale = signed256(10 ** (priceFeedBDecimals));

        if (decimals_ > 18) revert BadDecimals();
        decimals = decimals_;
        description = description_;
        priceFeedScale = int256(10 ** decimals);
    }

    /**
     * @notice Calculates the latest round data using data from the two price feeds
     * @return roundId Round id from price feed B
     * @return answer Latest price
     * @return startedAt Timestamp when the round was started; passed on from price feed B
     * @return updatedAt Timestamp when the round was last updated; passed on from price feed B
     * @return answeredInRound Round id in which the answer was computed; passed on from price feed B
     * @dev Note: Only the `answer` really matters for downstream contracts that use this price feed (e.g. Comet)
     **/
    function latestRoundData() override external view returns (uint80, int256, uint256, uint256, uint80) {
        (, int256 priceA, , , ) = AggregatorV3Interface(priceFeedA).latestRoundData();
        (uint80 roundId_, int256 priceB, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_) = AggregatorV3Interface(priceFeedB).latestRoundData();

        if (priceA <= 0 || priceB <= 0) return (roundId_, 0, startedAt_, updatedAt_, answeredInRound_);

        // int256 price = priceA * (priceFeedBScale/priceB) * priceFeedScale / priceFeedAScale;
        int256 price = priceA * priceFeedBScale * priceFeedScale / priceB / priceFeedAScale;
        return (roundId_, price, startedAt_, updatedAt_, answeredInRound_);
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
    }

    /**
     * @notice Price for the latest round
     * @return The version of the price feed contract
     **/
    function version() external pure returns (uint256) {
        return VERSION;
    }
}
