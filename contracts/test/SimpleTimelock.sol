// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @dev Simple Timelock for more realistic deployments and scenarios.
 *  Note: do not use in production!
 */
contract SimpleTimelock {
    event NewAdmin(address indexed newAdmin);
    event CancelTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta);
    event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta);
    event QueueTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta);

    address public admin;
    mapping (bytes32 => bool) public queuedTransactions;

    // For GovernorBravo initiation and compatability
    uint public constant proposalCount = 1;
    uint public constant delay = 0;
    uint public constant GRACE_PERIOD = 14 days;

    error Unauthorized();

    constructor(address admin_) {
        admin = admin_;
    }

    receive() external payable {}

    function acceptAdmin() external {
        return; // Note: not used, just for GovernorBravo compatability
    }

    function setAdmin(address newAdmin) external {
        if (msg.sender != admin) revert Unauthorized();
        admin = newAdmin;

        emit NewAdmin(newAdmin);
    }

    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) external returns (bytes32) {
        if (msg.sender != admin) revert Unauthorized();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data, eta);
        return txHash;
    }

    function cancelTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) external {
        if (msg.sender != admin) revert Unauthorized();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data, eta);
    }

    function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) external payable returns (bytes memory) {
        if (msg.sender != admin) revert Unauthorized();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        require(queuedTransactions[txHash], "Timelock::executeTransaction: Transaction hasn't been queued.");

        queuedTransactions[txHash] = false;

        bytes memory callData;

        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        require(success, "Timelock::executeTransaction: Transaction execution reverted.");

        emit ExecuteTransaction(txHash, target, value, signature, data, eta);

        return returnData;
    }

    // Executes multiple transactions without having to queue them up. Used for easier testing. Can be removed.
    function executeTransactions(address[] calldata targets, uint[] calldata values, string[] calldata signatures, bytes[] calldata data) external payable {
        if (msg.sender != admin) revert Unauthorized();

        for (uint i = 0; i < targets.length; i++) {
            bytes memory callData;

            if (bytes(signatures[i]).length == 0) {
                callData = data[i];
            } else {
                callData = abi.encodePacked(bytes4(keccak256(bytes(signatures[i]))), data[i]);
            }

            (bool success, ) = targets[i].call{value: values[i]}(callData);
            require(success, "failed to call");
        }
    }
}
