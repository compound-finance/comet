// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract ConstantPriceFeed is AggregatorV3Interface {
    /** Custom errors **/
    error InvalidInt256();
    error NotImplemented();

    /// @notice Version of the price feed
    uint public constant override version = 1;

    /// @notice Description of the price feed
    string public constant description = "Constant price feed";

    /// @notice Number of decimals for returned prices
    uint8 public immutable override decimals;

    /// @notice The constant price
    int private immutable CONSTANT_PRICE;

    /**
     * @notice Construct a new scaling price feed
     * @param decimals_ The number of decimals for the returned prices
     **/
    constructor(uint8 decimals_) {
        decimals = decimals_;
        CONSTANT_PRICE = signed256(10 ** decimals_);
    }

    /**
     * @notice Unimplemented function required to fulfill AggregatorV3Interface; always reverts
     **/
    function getRoundData(uint80 _roundId) override external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        revert NotImplemented();
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
        return (0, CONSTANT_PRICE, block.timestamp, block.timestamp, 0);
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
    }
}