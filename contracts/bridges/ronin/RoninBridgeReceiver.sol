// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../SweepableBridgeReceiver.sol";
import {IERC165} from "../../IERC165.sol";
import {IAny2EVMMessageReceiver, Any2EVMMessage} from "../../IAny2EVMMessageReceiver.sol";

contract RoninBridgeReceiver is SweepableBridgeReceiver, IERC165, IAny2EVMMessageReceiver{

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IAny2EVMMessageReceiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    error InvalidRouter();

    address public l2Router;

    constructor(address l2Router_) {
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
