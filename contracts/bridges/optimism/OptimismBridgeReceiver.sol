// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../BaseBridgeReceiver.sol";

interface OvmL2CrossDomainMessengerInterface {
    function xDomainMessageSender() external returns (address);
}

contract OptimismBridgeReceiver is BaseBridgeReceiver {
    error InvalidCrossDomainMessenger();

    event NewCrossDomainMessenger(address indexed oldCrossDomainMessenger, address indexed newCrossDomainMessenger);

    address public crossDomainMessenger;

    constructor(address crossDomainMessenger_) {
        crossDomainMessenger = crossDomainMessenger_;
    }

    function changeCrossDomainMessenger(address newCrossDomainMessenger) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldCrossDomainMessenger = crossDomainMessenger;
        crossDomainMessenger = newCrossDomainMessenger;
        emit NewCrossDomainMessenger(oldCrossDomainMessenger, newCrossDomainMessenger);
    }

    fallback() external payable {
        if (msg.sender != crossDomainMessenger) revert InvalidCrossDomainMessenger();
        address messageSender = OvmL2CrossDomainMessengerInterface(msg.sender).xDomainMessageSender();
        processMessage(messageSender, msg.data);
    }
}