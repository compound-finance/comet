// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

contract Delegator {
    address public timelock;

    function initialize(address _timelock) public {
        require(timelock == address(0), "already initialized");
        timelock = _timelock;
    }

    function call(address[] calldata targets, bytes[] calldata callDatas, uint256[] calldata values) public payable {
        require(msg.sender == timelock, "only timelock");
        require(targets.length == callDatas.length && targets.length == values.length, "targets and data length mismatch");
        for (uint i = 0; i < targets.length; i++) {
            (bool success, bytes memory returnData) = targets[i].call{value: values[i]}(callDatas[i]);
            if (!success) {
                // revert with the original error message from the call
                if (returnData.length > 0) {
                    // bubble up the error message from the call
                    assembly {
                        let returndata_size := mload(returnData)
                        revert(add(32, returnData), returndata_size)
                    }
                } else {
                    revert("Delegator: call failed");
                }
            }
        }
    }
}