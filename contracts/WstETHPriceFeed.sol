// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./IPriceFeed.sol";
import "./IWstETH.sol";

/**
 * @title wstETH price feed
 * @notice A custom price feed that calculates the price for wstETH / ETH
 * @author Compound
 */
contract WstETHPriceFeed is IPriceFeed {
    /** Custom errors **/
    error BadDecimals();
    error InvalidInt256();

    /// @notice Version of the price feed
    uint public constant override version = 1;

    /// @notice Description of the price feed
    string public constant override description = "Custom price feed for wstETH / ETH";

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice Chainlink stETH / ETH price feed
    address public immutable stETHtoETHPriceFeed;

    /// @notice Number of decimals for the stETH / ETH price feed
    uint public immutable stETHToETHPriceFeedDecimals;

    /// @notice WstETH contract address
    address public immutable wstETH;

    /// @notice Scale for WstETH contract
    int public immutable wstETHScale;

    constructor(address stETHtoETHPriceFeed_, address wstETH_, uint8 decimals_) {
        stETHtoETHPriceFeed = stETHtoETHPriceFeed_;
        stETHToETHPriceFeedDecimals = AggregatorV3Interface(stETHtoETHPriceFeed_).decimals();
        wstETH = wstETH_;
        // Note: Safe to convert directly to an int256 because wstETH.decimals == 18
        wstETHScale = int256(10 ** IWstETH(wstETH).decimals());

        // Note: stETH / ETH price feed has 18 decimals so `decimals_` should always be less than or equals to that
        if (decimals_ > stETHToETHPriceFeedDecimals) revert BadDecimals();
        decimals = decimals_;
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
    }

    /**
     * @notice WstETH price for the latest round
     * @return roundId Round id from the stETH price feed
     * @return answer Latest price for wstETH / USD
     * @return startedAt Timestamp when the round was started; passed on from stETH price feed
     * @return updatedAt Timestamp when the round was last updated; passed on from stETH price feed
     * @return answeredInRound Round id in which the answer was computed; passed on from stETH price feed
     **/
    function latestRoundData() override external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        (uint80 roundId_, int256 stETHPrice, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_) = AggregatorV3Interface(stETHtoETHPriceFeed).latestRoundData();
        uint256 tokensPerStEth = IWstETH(wstETH).tokensPerStEth();
        int256 price = stETHPrice * wstETHScale / signed256(tokensPerStEth);
        // Note: The stETH price feed should always have an equal or larger amount of decimals than this price feed (enforced by validation in constructor)
        int256 scaledPrice = price / int256(10 ** (stETHToETHPriceFeedDecimals - decimals));
        return (roundId_, scaledPrice, startedAt_, updatedAt_, answeredInRound_);
    }
}