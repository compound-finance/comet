// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../BaseBridgeReceiver.sol";

contract BaseBridgeReceiverHarness is BaseBridgeReceiver {
    function processMessageExternal(
        address rootMessageSender,
        bytes calldata data
    ) external {
        processMessage(rootMessageSender, data);
    }
}