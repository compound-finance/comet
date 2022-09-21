// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/fx-portal/contracts/FxChild.sol";
import "../BaseBridgeReceiver.sol";

contract PolygonBridgeReceiver is IFxMessageProcessor, BaseBridgeReceiver {
    error InvalidChild();

    event NewFxChild(address indexed oldFxChild, address indexed newFxChild);

    address public fxChild;

    constructor(address _fxChild) {
        fxChild = _fxChild;
    }

    function changeFxChild(address newFxChild) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldFxChild = fxChild;
        fxChild = newFxChild;
        emit NewFxChild(oldFxChild, newFxChild);
    }

    function processMessageFromRoot(
        uint256 stateId,
        address messageSender,
        bytes calldata data
    ) public override {
        if (msg.sender != fxChild) revert InvalidChild();
        processMessage(messageSender, data);
    }
}