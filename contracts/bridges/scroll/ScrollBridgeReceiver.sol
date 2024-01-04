// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../SweepableBridgeReceiver.sol";
import "./IScrollMessenger.sol";

/// @title Scroll Bridge Receiver
/// @notice Contract that processes messages passed from Compound governance using the Scroll bridge
contract ScrollBridgeReceiver is SweepableBridgeReceiver {
    error InvalidL2Messenger();

    event NewL2Messenger(address indexed oldL2Messenger, address indexed newL2Messenger);

    /// @notice Address of Scroll L2 Messenger contract
    address public l2Messenger;

    /// @notice Construct a new ScrollBridgeReceiver instance
    /// @param l2Messenger_ Address of Scroll L2 Messenger contract
    constructor(address l2Messenger_) {
        l2Messenger = l2Messenger_;
        emit NewL2Messenger(address(0), l2Messenger_);
    }

    /// @notice Update the L2 Messenger address
    /// @param newL2Messenger New address for L2 Messenger contract
    function changeL2Messenger(address newL2Messenger) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldL2Messenger = l2Messenger;
        l2Messenger = newL2Messenger;
        emit NewL2Messenger(oldL2Messenger, newL2Messenger);
    }

    /// @notice Fallback function to handle messages
    fallback() external payable {
        if (msg.sender != l2Messenger) revert InvalidL2Messenger();
        address messageSender = IScrollMessenger(msg.sender).xDomainMessageSender();
        processMessage(messageSender, msg.data);
    }
}