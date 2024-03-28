// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/// @notice IScrollMessenger is the interface for Scroll's messenger contract
interface IScrollMessenger {
  function xDomainMessageSender() external view returns (address);
}
