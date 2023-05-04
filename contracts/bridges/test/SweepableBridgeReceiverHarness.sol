// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../SweepableBridgeReceiver.sol";

contract SweepableBridgeReceiverHarness is SweepableBridgeReceiver {
    function processMessageExternal(
        address rootMessageSender,
        bytes calldata data
    ) external {
        processMessage(rootMessageSender, data);
    }

    fallback() external payable { }
}
