// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./IPriceFeed.sol";

/**
 * @title Constant price feed
 * @notice A custom price feed that always returns a constant price
 * @author Compound
 */
contract ConstantPriceFeed is IPriceFeed {
    /// @notice Version of the price feed
    uint public constant override version = 1;

    /// @notice Description of the price feed
    string public constant description = "Constant price feed";

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice The constant price
    int public immutable constantPrice;

    /**
     * @notice Construct a new scaling price feed
     * @param decimals_ The number of decimals for the returned prices
     **/
    constructor(uint8 decimals_, int256 constantPrice_) {
        decimals = decimals_;
        constantPrice = constantPrice_;
    }

    /**
     * @notice Price for the latest round
     * @return roundId Round id from the underlying price feed
     * @return answer Latest price for the asset (will always be a constant price)
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
        return (1, constantPrice, block.timestamp, block.timestamp, 1);
    }
}