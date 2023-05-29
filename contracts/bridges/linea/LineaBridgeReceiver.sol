// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import './IMessageService.sol';
import '../BaseBridgeReceiver.sol';

contract ArbitrumBridgeReceiver is BaseBridgeReceiver {
    /// @notice Address of Linea Message Service
    IMessageService public messageService;

    constructor(address _messageService) {
        // Can we keep this a constructor or should we extend the initialize
        // function of BaseBridgeReceiver?
        messageService = _messageService;
    }

    fallback() external payable {
        // Should we keep it payable?
        if (msg.sender != messageService) revert Unauthorized();
        processMessage(messageService.sender(), msg.data);
    }
}
