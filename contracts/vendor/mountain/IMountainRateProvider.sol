// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IMountainRateProvider {
  function decimals() external view returns (uint8);
  function convertToAssets(uint256) external view returns (uint256);
}
