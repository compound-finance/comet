// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../IPriceFeed.sol";

/**
 * @title WBTC price feed
 * @notice A custom price feed that calculates the price for WBTC / USD
 * @author Compound
 */
contract WBTCPriceFeed is IPriceFeed {
    /** Custom errors **/
    error BadDecimals();
    error InvalidInt256();

    /// @notice Version of the price feed
    uint public constant override version = 1;

    /// @notice Description of the price feed
    string public constant override description = "Custom price feed for WBTC / USD";

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice Chainlink WBTC / BTC price feed
    address public immutable WBTCToBTCPriceFeed;

    /// @notice Chainlink BTC / USD price feed
    address public immutable BTCToUSDPriceFeed;

    /// @notice Combined scale of the two underlying Chainlink price feeds
    int public immutable combinedScale;

    /// @notice Scale of this price feed
    int public immutable priceFeedScale;

    /**
     * @notice Construct a new WBTC / USD price feed
     * @param WBTCToBTCPriceFeed_ The address of the WBTC / BTC price feed to fetch prices from
     * @param BTCToUSDPriceFeed_ The address of the BTC / USD price feed to fetch prices from
     * @param decimals_ The number of decimals for the returned prices
     **/
    constructor(address WBTCToBTCPriceFeed_, address BTCToUSDPriceFeed_, uint8 decimals_) {
        WBTCToBTCPriceFeed = WBTCToBTCPriceFeed_;
        BTCToUSDPriceFeed = BTCToUSDPriceFeed_;
        uint8 WBTCToBTCPriceFeedDecimals = AggregatorV3Interface(WBTCToBTCPriceFeed_).decimals();
        uint8 BTCToUSDPriceFeedDecimals = AggregatorV3Interface(BTCToUSDPriceFeed_).decimals();
        combinedScale = signed256(10 ** (WBTCToBTCPriceFeedDecimals + BTCToUSDPriceFeedDecimals));

        if (decimals_ > 18) revert BadDecimals();
        decimals = decimals_;
        priceFeedScale = int256(10 ** decimals);
    }

    /**
     * @notice WBTC price for the latest round
     * @return roundId Round id from the BTC / USD price feed
     * @return answer Latest price for WBTC / USD
     * @return startedAt Timestamp when the round was started; passed on from the BTC / USD price feed
     * @return updatedAt Timestamp when the round was last updated; passed on from the BTC / USD price feed
     * @return answeredInRound Round id in which the answer was computed; passed on from the BTC / USD price feed
     **/
    function latestRoundData() override external view returns (uint80, int256, uint256, uint256, uint80) {
        (, int256 WBTCToBTCPrice, , , ) = AggregatorV3Interface(WBTCToBTCPriceFeed).latestRoundData();
        (uint80 roundId_, int256 BTCToUSDPrice, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_) = AggregatorV3Interface(BTCToUSDPriceFeed).latestRoundData();

        // We return the round data of the BTC / USD price feed because of its shorter heartbeat (1hr vs 24hr)
        if (WBTCToBTCPrice <= 0 || BTCToUSDPrice <= 0) return (roundId_, 0, startedAt_, updatedAt_, answeredInRound_);

        int256 price = WBTCToBTCPrice * BTCToUSDPrice * priceFeedScale / combinedScale;
        return (roundId_, price, startedAt_, updatedAt_, answeredInRound_);
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
    }
}