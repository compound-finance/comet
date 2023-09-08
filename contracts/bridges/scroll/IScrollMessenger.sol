// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

interface IScrollMessenger {
  function xDomainMessageSender() external view returns (address);
}
