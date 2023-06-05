// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./ITelepathy.sol";

// solhint-disable-next-line contract-name-camelcase
// TODO: Should implement Comet's adapter interface once added.
contract SuccinctAdapter {
    ITelepathyRouter public immutable telepathyRouter;
    uint16 public immutable destinationChainId;

    // Special Succinct event for additional tracking information.
    event SuccinctMessageRelayed(bytes32 messageRoot, uint16 destinationChainId, address target, bytes message);

    /**
     * @notice Constructs new Adapter.
     * @param _telepathyRouter address of the TelepathyRouter Succinct contract for sending messages.
     * @param _destinationChainId chainId of the destination.
     */
    constructor(ITelepathyRouter _telepathyRouter, uint16 _destinationChainId) {
        telepathyRouter = _telepathyRouter;
        destinationChainId = _destinationChainId;
    }

    /**
     * @notice Send cross-chain message to target on the destination.
     * @param target Contract on the destination that will receive the message.
     * @param message Data to send to target.
     */
    function relayMessage(address target, bytes calldata message) external payable {
        bytes32 messageRoot = telepathyRouter.send(destinationChainId, target, message);

        // Note: This should emit two events, SuccinctMessageRelayed & MessageRelayed from the Compound adapter.
        // It emits SuccinctMessageRelayed to encode additional tracking information that is Succinct-specific.
        emit SuccinctMessageRelayed(messageRoot, destinationChainId, target, message);
    }
}