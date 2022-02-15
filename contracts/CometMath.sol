// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

/**
 * @title Compound's Comet Math Contract
 * @dev Pure math functions
 * @author Compound
 */
contract CometMath {
    function min(uint104 a, uint104 b) internal pure returns (uint104) {
        return a < b ? a : b;
    }

    function safe64(uint n) internal pure returns (uint64) {
        require(n <= type(uint64).max, "overflow");
        return uint64(n);
    }

    function safe104(uint n) internal pure returns (uint104) {
        require(n <= type(uint104).max, "overflow");
        return uint104(n);
    }

    function safe128(uint n) internal pure returns (uint128) {
        require(n <= type(uint128).max, "overflow");
        return uint128(n);
    }

    function signed64(uint64 n) internal pure returns (int64) {
        require(n <= uint64(type(int64).max), "overflow");
        return int64(n);
    }

    function signed104(uint104 n) internal pure returns (int104) {
        require(n <= uint104(type(int104).max), "overflow");
        return int104(n);
    }

    function signed128(uint128 n) internal pure returns (int128) {
        require(n <= uint128(type(int128).max), "overflow");
        return int128(n);
    }

    function signed256(uint256 n) internal pure returns (int256) {
        require(n <= uint256(type(int256).max), "overflow");
        return int256(n);
    }

    function unsigned104(int104 n) internal pure returns (uint104) {
        require(n >= 0, "underflow");
        return uint104(n);
    }

    function unsigned256(int256 n) internal pure returns (uint256) {
        require(n >= 0, "underflow");
        return uint256(n);
    }

    function toUInt8(bool x) internal pure returns (uint8) {
        return x ? 1 : 0;
    }

    function toBool(uint8 x) internal pure returns (bool) {
        return x != 0;
    }
}
