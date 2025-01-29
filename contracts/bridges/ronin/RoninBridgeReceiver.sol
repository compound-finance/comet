// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../SweepableBridgeReceiver.sol";

contract RoninBridgeReceiver is SweepableBridgeReceiver {
    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender;
        bytes data;
        EVMTokenAmount[] destTokenAmounts;
    }
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }

    error InvalidRouter();

    address public l2Router;

    constructor(address  l2Router_) {
        l2Router = l2Router_;
    }

    function ccipReceive(Any2EVMMessage calldata message) external {
        if (msg.sender != l2Router) revert InvalidRouter();
        processMessage(toAddress(message.sender), message.data);
    }

    function toAddress(bytes memory data) public pure returns (address addr) {
        require(data.length >= 20, "Invalid data length");
        return abi.decode(data, (address));
    }
}
