// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "../../contracts/CometMath.sol";

contract CometMathHarness is CometMath {
    function minHarness(uint104 a, uint104 b) external pure returns (uint104) {
        return min(a, b);
    }

    function safe64Harness(uint n) external pure returns (uint64) {
        return safe64(n);
    }

    function safe104Harness(uint n) external pure returns (uint104) {
        return safe104(n);
    }

    function safe128Harness(uint n) external pure returns (uint128) {
        return safe128(n);
    }

    function signed64Harness(uint64 n) external pure returns (int64) {
        return signed64(n);
    }

    function signed104Harness(uint104 n) external pure returns (int104) {
        return signed104(n);
    }

    function signed128Harness(uint128 n) external pure returns (int128) {
        return signed128(n);
    }

    function signed256Harness(uint256 n) external pure returns (int256) {
        return signed256(n);
    }

    function unsigned104Harness(int104 n) external pure returns (uint104) {
        return unsigned104(n);
    }

    function unsigned256Harness(int256 n) external pure returns (uint256) {
        return unsigned256(n);
    }

    function toUInt8Harness(bool x) external pure returns (uint8) {
        return toUInt8(x);
    }

    function toBoolHarness(uint8 x) external pure returns (bool) {
        return toBool(x);
    }
}