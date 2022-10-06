// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./IFxMessageProcessor.sol";
import "../BaseBridgeReceiver.sol";

contract PolygonBridgeReceiver is IFxMessageProcessor, BaseBridgeReceiver {
    error InvalidChild();

    event NewFxChild(address indexed oldFxChild, address indexed newFxChild);

    /// @notice Address of Polygon's bridged message receiver
    address public fxChild;

    /**
     * @notice Construct a new PolygonBridgeReceiver instance
     * @param _fxChild Address of Polygon bridged message receiver
     **/
    constructor(address _fxChild) {
        fxChild = _fxChild;
    }

    /**
     * @notice Update the fxChild address
     * @param newFxChild New value for fxAddress
     */
    function changeFxChild(address newFxChild) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldFxChild = fxChild;
        fxChild = newFxChild;
        emit NewFxChild(oldFxChild, newFxChild);
    }

    /**
     * @notice Receive bridged message and enqueue in the Timelock
     * @param stateId Value provided by fxChild when function is called; ignored
     * @param rootMessageSender Mainnet address that initiated the bridged message
     * @param data ABI-encoded data of the bridged message
     */
    function processMessageFromRoot(
        uint256 stateId,
        address rootMessageSender,
        bytes calldata data
    ) public override {
        if (msg.sender != fxChild) revert InvalidChild();
        processMessage(rootMessageSender, data);
    }
}