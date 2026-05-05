// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

import {SyntheticSender} from "../lib/SyntheticSender.sol";

/// @title SyntheticSenderHarness
/// @notice Wraps the SyntheticSender library so unit tests can call into it.
contract SyntheticSenderHarness {
    string public constant SALT = "rome.protocol.unified-token.synthetic-sender.v1";

    function derive(bytes32 solanaPubkey) external pure returns (address) {
        return SyntheticSender.derive(solanaPubkey);
    }
}
