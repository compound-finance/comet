// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/swell/IRswETH.sol";
import "../IPriceFeed.sol";

/**
 * @title rswETH Scaling price feed
 * @notice A custom price feed that scales up or down the price received from an underlying rswETH / ETH exchange rate price feed and returns the result
 * @author Compound
 */
contract RswETHExchangePriceFeed is IPriceFeed {
    /** Custom errors **/
    error InvalidInt256();
    error BadDecimals();

    /// @notice Version of the price feed
    uint public constant VERSION = 1;

    /// @notice Description of the price feed
    string public description;

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice rswETH price feed where prices are fetched from
    address public immutable underlyingPriceFeed;

    /// @notice Whether or not the price should be upscaled
    bool internal immutable shouldUpscale;

    /// @notice The amount to upscale or downscale the price by
    int256 internal immutable rescaleFactor;

    /**
     * @notice Construct a new rswETH scaling price feed
     * @param rswETH The address of the rswETH to fetch prices from
     * @param decimals_ The number of decimals for the returned prices
     **/
    constructor(address rswETH, uint8 decimals_, string memory description_) {
        underlyingPriceFeed = rswETH;
        if (decimals_ > 18) revert BadDecimals();
        decimals = decimals_;
        description = description_;

        uint8 rswETHDecimals = 18;
        // Note: Solidity does not allow setting immutables in if/else statements
        shouldUpscale = rswETHDecimals < decimals_ ? true : false;
        rescaleFactor = (shouldUpscale
            ? signed256(10 ** (decimals_ -rswETHDecimals))
            : signed256(10 ** (rswETHDecimals - decimals_))
        );
    }

    /**
     * @notice Price for the latest round
     * @return roundId Round id from the underlying price feed
     * @return answer Latest price for the asset in terms of ETH
     * @return startedAt Timestamp when the round was started; passed on from underlying price feed
     * @return updatedAt Timestamp when the round was last updated; passed on from underlying price feed
     * @return answeredInRound Round id in which the answer was computed; passed on from underlying price feed
     **/
    function latestRoundData() override external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        uint256 rate = IRswETH(underlyingPriceFeed).rswETHToETHRate();
        // protocol uses only the answer value. Other data fields are not provided by the underlying pricefeed and are not used in Comet protocol
        // https://etherscan.io/address/0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0#readProxyContract#F14
        return (1, scalePrice(signed256(rate)), block.timestamp, block.timestamp, 1);
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
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
     * @notice Price for the latest round
     * @return The version of the price feed contract
     **/
    function version() external pure returns (uint256) {
        return VERSION;
    }
}