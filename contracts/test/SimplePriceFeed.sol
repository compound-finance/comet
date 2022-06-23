// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract SimplePriceFeed is AggregatorV3Interface {
    int public price;

    uint8 public immutable override decimals;

    string public constant override description = "Mock Chainlink price aggregator";

    uint public constant override version = 1;

    constructor(int initialPrice, uint8 decimals_) {
        price = initialPrice;
        decimals = decimals_;
    }

    function setPrice(int price_) public {
        price = price_;
    }

    function getRoundData(uint80 _roundId) override external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, price, 0, 0, 0);
    }

    function latestRoundData() override external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (0, price, 0, 0, 0);
    }
}
