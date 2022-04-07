// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

/**
 * @title Certora's price oracle A contract for comet
 * @notice Simulates a price oracle that retrieves answer based on timestamp
 * @author Certora
 */
contract SymbolicPriceOracleA {
    // The entire information is stored in global variables
    uint80 public roundId;
    // The answer is stored as a map with timestamp as the key.
    // For each timestamp the relevant answer is stored
    mapping (uint256 => int256) public answer;
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
