// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface IWstETH {
    function decimals() external view returns (uint8);
    function tokensPerStEth() external view returns (uint256);
}

contract WstETHPriceFeed is AggregatorV3Interface {
    /** Custom errors **/
    error InvalidInt256();
    error NotImplemented();

    string public constant override description = "Custom price feed for wstETH / USD";

    uint public constant override version = 1;

    /// @notice Scale for returned prices
    uint8 public override decimals = 8;

    /// @notice Chainlink stETH / USD price feed
    address public immutable stETHtoUSDPriceFeed;

    /// @notice WstETH contract address
    address public immutable wstETH;

    /// @notice scale for WstETH contract
    uint public immutable wstETHScale;

    constructor(address stETHtoUSDPriceFeed_, address wstETH_) {
        stETHtoUSDPriceFeed = stETHtoUSDPriceFeed_;
        wstETH = wstETH_;
        wstETHScale = 10 ** IWstETH(wstETH).decimals();
    }

    function signed256(uint256 n) internal pure returns (int256) {
        if (n > uint256(type(int256).max)) revert InvalidInt256();
        return int256(n);
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
     * @notice WstETH Price for the latest round
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
        (uint80 roundId, int256 stETHPrice, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) = AggregatorV3Interface(stETHtoUSDPriceFeed).latestRoundData();
        uint256 tokensPerStEth = IWstETH(wstETH).tokensPerStEth();
        int256 price = stETHPrice * int256(wstETHScale) / signed256(tokensPerStEth);
        return (roundId, price, startedAt, updatedAt, answeredInRound);
    }
}