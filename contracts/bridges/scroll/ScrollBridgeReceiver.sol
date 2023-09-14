// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../SweepableBridgeReceiver.sol";
import "./IScrollMessenger.sol";

contract ScrollBridgeReceiver is SweepableBridgeReceiver {
    error InvalidL2Messenger();

    event Newl2Messenger(address indexed oldL2Messenger, address indexed newL2Messenger);

    address public l2Messenger;

    constructor(address l2Messenger_) {
        l2Messenger = l2Messenger_;
    }

    function changel2Messenger(address newL2Messenger) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldL2Messenger = l2Messenger;
        l2Messenger = newL2Messenger;
        emit Newl2Messenger(oldL2Messenger, newL2Messenger);
    }

    fallback() external payable {
        if (msg.sender != l2Messenger) revert InvalidL2Messenger();
        address messageSender = IScrollMessenger(msg.sender).xDomainMessageSender();
        processMessage(messageSender, msg.data);
    }
}