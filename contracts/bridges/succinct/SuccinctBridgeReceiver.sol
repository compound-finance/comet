// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../SweepableBridgeReceiver.sol";

interface ITelepathyHandler {
    function handleTelepathy(uint32 _sourceChainId, address _sourceAddress, bytes calldata _data)
        external
        returns (bytes4);
}

contract SuccinctBridgeReceiver is SweepableBridgeReceiver, ITelepathyHandler {
    error InvalidSourceChain();

    address public telepathyReceiver;
    uint32 public sourceChainId;

    constructor(address _telepathyReceiver, uint32 _sourceChainId) {
        telepathyReceiver = _telepathyReceiver;
        sourceChainId = _sourceChainId;
    }

    function handleTelepathy(uint32 _sourceChainId, address _sourceAddress, bytes calldata _data) external returns (bytes4)  {
        if (msg.sender != telepathyReceiver) revert Unauthorized();

        if (_sourceChainId != sourceChainId) revert InvalidSourceChain();

        processMessage(_sourceAddress, _data);
        return ITelepathyHandler.handleTelepathy.selector;
    }
}