// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

/**
 * @dev Simple Timelock for more realistic deployments and scenarios.
 */
contract SimpleTimelock {
    event NewAdmin(address indexed newAdmin);
    event CancelTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data);
    event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data);
    event QueueTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data);

    address public admin;
    mapping (bytes32 => bool) public queuedTransactions;

    error Unauthorized();

    constructor(address admin_) {
        admin = admin_;
    }

    function setAdmin(address newAdmin) public {
        if (msg.sender != address(this)) revert Unauthorized(); // call must come from Timelock itself
        admin = newAdmin;

        emit NewAdmin(newAdmin);
    }

    function queueTransaction(address target, uint value, string memory signature, bytes memory data) public returns (bytes32) {
        if (msg.sender != admin) revert Unauthorized();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data);
        return txHash;
    }

    function cancelTransaction(address target, uint value, string memory signature, bytes memory data) public {
        if (msg.sender != admin) revert Unauthorized();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data);
    }

    function executeTransaction(address target, uint value, string memory signature, bytes memory data) public payable returns (bytes memory) {
        if (msg.sender != admin) revert Unauthorized();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data));
        require(queuedTransactions[txHash], "Timelock::executeTransaction: Transaction hasn't been queued.");

        queuedTransactions[txHash] = false;

        bytes memory callData;

        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        // solium-disable-next-line security/no-call-value
        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        require(success, "Timelock::executeTransaction: Transaction execution reverted.");

        emit ExecuteTransaction(txHash, target, value, signature, data);

        return returnData;
    }

    // Executes multiple transactions without having to queue them up. Used for easier testing. Can be removed.
    function executeTransactions(address[] calldata targets, uint[] calldata values, string[] calldata signatures, bytes[] calldata data) public payable {
        if (msg.sender != admin) revert Unauthorized();

        for (uint i = 0; i < targets.length; i++) {
            bytes memory callData;

            if (bytes(signatures[i]).length == 0) {
                callData = data[i];
            } else {
                callData = abi.encodePacked(bytes4(keccak256(bytes(signatures[i]))), data[i]);
            }

            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = targets[i].call{value: values[i]}(callData);
            require(success, "failed to call");
        }
    }
}
