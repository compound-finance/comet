// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

interface OvmL2CrossDomainMessengerInterface {
    function xDomainMessageSender() external returns (address);
}
