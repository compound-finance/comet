// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

/**
 * @title Certora's price oracle A contract for comet
 * @notice wrappers for internal function checks
 * @author Certora
 */

contract symbolicPriceOracleA {
    uint80 public roundId;
    mapping ( uint256 => int256) public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;

    uint8 public decimals;

    function latestRoundData()
        external
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (roundId, answer[block.timestamp], startedAt, updatedAt, answeredInRound);
    }
}