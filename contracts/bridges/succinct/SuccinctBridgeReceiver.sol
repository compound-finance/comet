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

    function handleTelepathy(uint16 _sourceChainId, address _senderAddress, bytes memory _data) {
        require (msg.sender == telepathyRouter, "SuccinctBridgeReceiver: only telepathyRouter can call this function");
        require (_sourceChainId == sourceChainId, "SuccinctBridgeReceiver: sourceChainId mismatch");
        require (_senderAddress == govTimelock, "SuccinctBridgeReceiver: senderAddress mismatch")
        processMessage(_senderAddress, _data);
    }

    function setTelepathyRouter(address newTelepathyRouter) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldTelepathyRouter = telepathyRouter;
        telepathyRouter = newTelepathyRouter;
        emit NewCrossDomainMessenger(oldTelepathyRouter, telepathyRouter);
    }
}