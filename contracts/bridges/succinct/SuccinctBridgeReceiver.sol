// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../SweepableBridgeReceiver.sol";
import "./ITelepathy.sol";

contract SuccinctBridgeReceiver is SweepableBridgeReceiver, ITelepathyHandler {
    error InvalidSourceChain();

    ITelepathyReceiver public telepathyReceiver;
    uint32 public sourceChainId;

    constructor(address _telepathyReceiver, uint32 _sourceChainId) {
        telepathyReceiver = ITelepathyReceiver(_telepathyReceiver);
        sourceChainId = _sourceChainId;
    }

    function handleTelepathy(uint32 _sourceChainId, address _sourceAddress, bytes calldata _data) external returns (bytes4)  {
        if (msg.sender != address(telepathyReceiver)) revert Unauthorized();

        if (_sourceChainId != sourceChainId) revert InvalidSourceChain();

        processMessage(_sourceAddress, _data);
        return ITelepathyHandler.handleTelepathy.selector;
    }
}