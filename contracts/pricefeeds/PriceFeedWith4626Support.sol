// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../IERC4626.sol";
import "../IPriceFeed.sol";

/**
 * @title Price feed for ERC4626 assets
 * @notice A custom price feed that calculates the price for an ERC4626 asset
 * @author Compound
 */
contract PriceFeedWith4626Support is IPriceFeed {
    /** Custom errors **/
    error BadDecimals();
    error InvalidInt256();

    /// @notice Version of the price feed
    uint public constant VERSION = 1;

    /// @notice Description of the price feed
    string public override description;

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice Number of decimals for the 4626 rate provider
    uint8 internal immutable rateProviderDecimals;

    /// @notice Number of decimals for the underlying asset
    uint8 internal immutable underlyingDecimals;

    /// @notice 4626 rate provider
    address public immutable rateProvider;

    /// @notice Chainlink oracle for the underlying asset
    address public immutable underlyingPriceFeed;

    /// @notice Combined scale of the two underlying price feeds
    int public immutable combinedScale;

    /// @notice Scale of this price feed
    int public immutable priceFeedScale;

    /**
     * @notice Construct a new 4626 price feed
     * @param rateProvider_ The address of the 4626 rate provider
     * @param underlyingPriceFeed_ The address of the underlying asset price feed to fetch prices from
     * @param decimals_ The number of decimals for the returned prices
     * @param description_ The description of the price feed
     **/
    constructor(address rateProvider_, address underlyingPriceFeed_, uint8 decimals_, string memory description_) {
        rateProvider = rateProvider_;
        underlyingPriceFeed = underlyingPriceFeed_;
        rateProviderDecimals = IERC4626(rateProvider_).decimals();
        underlyingDecimals = AggregatorV3Interface(underlyingPriceFeed_).decimals();
        combinedScale = signed256(10 ** (rateProviderDecimals + underlyingDecimals));
        description = description_;

        if (decimals_ > 18) revert BadDecimals();
        decimals = decimals_;
        priceFeedScale = int256(10 ** decimals);
    }

    /**
     * @notice Get the latest price for the underlying asset
     * @return roundId Round id from the underlying asset price feed
     * @return answer Latest price for the underlying asset
     * @return startedAt Timestamp when the round was started; passed on from the underlying asset price feed
     * @return updatedAt Timestamp when the round was last updated; passed on from the underlying asset price feed
     * @return answeredInRound Round id in which the answer was computed; passed on from the underlying asset price feed
     **/
    function latestRoundData() override external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 rate = IERC4626(rateProvider).convertToAssets(10**rateProviderDecimals);
        (uint80 roundId_, int256 underlyingPrice, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_) = AggregatorV3Interface(underlyingPriceFeed).latestRoundData();

        if (rate <= 0 || underlyingPrice <= 0) return (roundId_, 0, startedAt_, updatedAt_, answeredInRound_);

        int256 price = signed256(rate) * underlyingPrice * priceFeedScale / combinedScale;
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