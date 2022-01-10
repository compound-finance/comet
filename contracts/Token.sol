// SPDX-License-Identifier: XXX
pragma solidity ^0.8.0;

interface Token {
  function balanceOf(address) external view returns (uint);
  function transfer(address, uint) external returns (bool);
  function transferFrom(address, address, uint) external returns(bool);
}