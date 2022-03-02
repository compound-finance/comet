// SPDX-License-Identifier: XXX ADD VALID LICENSE

pragma solidity ^0.8.11;

/**
 * @dev Simple Timelock for more realistic deployments and scenarios.
 */
contract Timelock {

    function execute(address[] calldata targets, uint[] calldata values, string[] calldata signatures, bytes[] calldata data) public {
        for (uint i = 0; i < targets.length; i++) {
            bytes memory callData;

            if (bytes(signatures[i]).length == 0) {
                callData = data[i];
            } else {
                callData = abi.encodePacked(bytes4(keccak256(bytes(signatures[i]))), data[i]);
            }

            // solium-disable-next-line security/no-call-value
            (bool success, bytes memory returnData) = targets[i].call{value: values[i]}(callData);
            require(success, "failed to call");
        }
    }
}
