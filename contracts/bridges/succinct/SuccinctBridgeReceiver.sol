// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../BaseBridgeReceiver.sol";
import "./ITelepathy.sol";

contract SuccinctBridgeReceiver is BaseBridgeReceiver, ITelepathyHandler {
    address public telepathyRouter;

    // Mainnet Chain ID
    uint16 public constant sourceChainId = 1;

    event NewTelepathyRouter(address indexed oldTelepathyRouter, address indexed newTelepathyRouter);

    constructor(address _telepathyRouter) {
        telepathyRouter = _telepathyRouter;
    }

    function handleTelepathy(uint32 _sourceChainId, address _sourceAddress, bytes calldata _data) external returns (bytes4)  {
        require (msg.sender == telepathyRouter, "SuccinctBridgeReceiver: only telepathyRouter can call this function");
        require (_sourceChainId == sourceChainId, "SuccinctBridgeReceiver: sourceChainId mismatch");
        require (_sourceAddress == govTimelock, "SuccinctBridgeReceiver: senderAddress mismatch");
        processMessage(_sourceAddress, _data);
        return ITelepathyHandler.handleTelepathy.selector;
    }

    function setTelepathyRouter(address newTelepathyRouter) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldTelepathyRouter = telepathyRouter;
        telepathyRouter = newTelepathyRouter;
        emit NewTelepathyRouter(oldTelepathyRouter, telepathyRouter);
    }
}