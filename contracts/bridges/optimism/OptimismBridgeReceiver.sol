// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../SweepableBridgeReceiver.sol";
import "./IOvmL2CrossDomainMessengerInterface.sol";

contract OptimismBridgeReceiver is SweepableBridgeReceiver {
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
        address messageSender = IOvmL2CrossDomainMessengerInterface(msg.sender).xDomainMessageSender();
        processMessage(messageSender, msg.data);
    }
}