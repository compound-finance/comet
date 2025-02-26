// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometMainInterface.sol";

contract LiquidatableQuery {
  function query(CometMainInterface comet, address[] calldata accounts) public view returns (uint256, bool[] memory) {
    bool[] memory responses = new bool[](accounts.length);
    for (uint256 i = 0; i < accounts.length; i++) {
      responses[i] = comet.isLiquidatable(accounts[i]);
    }
    return (block.number, responses);
  }
}
