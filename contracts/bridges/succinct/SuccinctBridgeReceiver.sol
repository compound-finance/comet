// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../BaseBridgeReceiver.sol";
import "./ITelepathy.sol";

contract SuccinctBridgeReceiver is BaseBridgeReceiver, ITelepathyHandler {
    ITelepathyReceiver public telepathyReceiver;

    constructor(address _telepathyReceiver) {
        telepathyReceiver = ITelepathyReceiver(_telepathyReceiver);
    }

    function handleTelepathy(uint32 _sourceChainId, address _sourceAddress, bytes calldata _data) external returns (bytes4)  {
        processMessage(_sourceAddress, _data);
        return ITelepathyHandler.handleTelepathy.selector;
    }

    receive() external payable {
    }

    fallback() external payable {
        processMessage(msg.sender, msg.data);
    }
}