// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../vendor/mountain/IMountainRateProvider.sol";
import "../IPriceFeed.sol";

/**
 * @title wUSDM price feed
 * @notice A custom price feed that calculates the price for wUSDM / USD
 * @author Compound
 */
contract WUSDMPriceFeed is IPriceFeed {
    /** Custom errors **/
    error BadDecimals();
    error InvalidInt256();

    /// @notice Version of the price feed
    uint public constant override version = 1;

    /// @notice Description of the price feed
    string public constant override description = "Custom price feed for wUSDM / USD";

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice Number of decimals for the wUSDM / USDM rate provider
    uint8 wUSDMToUSDMPriceFeedDecimals;

    /// @notice Number of decimals for the USDM / USD price feed
    uint8 USDMToUSDPriceFeedDecimals;

    /// @notice Mountain wUSDM / USDM rate provider
    address public immutable wUSDMToUSDMRateProvider;

    /// @notice Chainlink USDM / USD price feed
    address public immutable USDMToUSDPriceFeed;

    /// @notice Combined scale of the two underlying price feeds
    int public immutable combinedScale;

    /// @notice Scale of this price feed
    int public immutable priceFeedScale;

    /**
     * @notice Construct a new wUSDM / USD price feed
     * @param wUSDMToUSDMPriceFeed_ The address of the wUSDM / USDM price feed to fetch prices from
     * @param USDMToUSDPriceFeed_ The address of the USDM / USD price feed to fetch prices from
     * @param decimals_ The number of decimals for the returned prices
     **/
    constructor(address wUSDMToUSDMPriceFeed_, address USDMToUSDPriceFeed_, uint8 decimals_) {
        wUSDMToUSDMRateProvider = wUSDMToUSDMPriceFeed_;
        USDMToUSDPriceFeed = USDMToUSDPriceFeed_;
        wUSDMToUSDMPriceFeedDecimals = IMountainRateProvider(wUSDMToUSDMPriceFeed_).decimals();
        USDMToUSDPriceFeedDecimals = AggregatorV3Interface(USDMToUSDPriceFeed_).decimals();
        combinedScale = signed256(10 ** (wUSDMToUSDMPriceFeedDecimals + USDMToUSDPriceFeedDecimals));

        if (decimals_ > 18) revert BadDecimals();
        decimals = decimals_;
        priceFeedScale = int256(10 ** decimals);
    }

    /**
     * @notice wUSDM price for the latest round
     * @return roundId Round id from the USDM / USD price feed
     * @return answer Latest price for wUSDM / USD
     * @return startedAt Timestamp when the round was started; passed on from the USDM / USD price feed
     * @return updatedAt Timestamp when the round was last updated; passed on from the USDM / USD price feed
     * @return answeredInRound Round id in which the answer was computed; passed on from the USDM / USD price feed
     **/
    function latestRoundData() override external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 wUSDMToUSDMPrice = IMountainRateProvider(wUSDMToUSDMRateProvider).convertToAssets(10**wUSDMToUSDMPriceFeedDecimals);
        (uint80 roundId_, int256 USDMToUSDPrice, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_) = AggregatorV3Interface(USDMToUSDPriceFeed).latestRoundData();

        // We return the round data of the USDM / USD price feed because of its shorter heartbeat (1hr vs 24hr)
        if (wUSDMToUSDMPrice <= 0 || USDMToUSDPrice <= 0) return (roundId_, 0, startedAt_, updatedAt_, answeredInRound_);

        int256 price = signed256(wUSDMToUSDMPrice) * USDMToUSDPrice * priceFeedScale / combinedScale;
        return (roundId_, price, startedAt_, updatedAt_, answeredInRound_);
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
    }
}