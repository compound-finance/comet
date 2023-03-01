// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../BaseBridgeReceiver.sol";
import "./AddressAliasHelper.sol";

contract ArbitrumBridgeReceiver is BaseBridgeReceiver {
    /**
     * @notice Receive bridged message and enqueue in the Timelock
     * @param data ABI-encoded data of the bridged message
     */
    function processMessageFromRoot(
        bytes calldata data
    ) public {
        processMessage(AddressAliasHelper.undoL1ToL2Alias(msg.sender), data);
    }
}