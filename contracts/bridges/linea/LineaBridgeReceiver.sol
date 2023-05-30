// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import './IMessageService.sol';
import '../BaseBridgeReceiver.sol';

contract LineaBridgeReceiver is BaseBridgeReceiver {
    /// @notice Address of Linea Message Service
    IMessageService public messageService;

    constructor(address _messageService) {
        // Can we keep this a constructor or should we extend the initialize
        // function of BaseBridgeReceiver?
        messageService = IMessageService(_messageService);
    }

    fallback() external {
        // Should we keep it payable (see Arb)?
        if (msg.sender != address(messageService)) revert Unauthorized();
        processMessage(messageService.sender(), msg.data);
    }
}
