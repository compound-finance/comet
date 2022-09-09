// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../ITimelock.sol";

contract BridgeTimelock is ITimelock {
    /** Custom errors **/
    error BadDelay();
    error BadETA();
    error TransactionExpired();
    error TransactionNotQueued();
    error TransactionNotReady(); //
    error TransactionReverted();
    error Unauthorized();

    uint public constant GRACE_PERIOD = 14 days;
    uint public constant MINIMUM_DELAY = 2 days; // XXX lower min?
    uint public constant MAXIMUM_DELAY = 30 days;

    address public admin;
    address public pendingAdmin;
    uint public delay;

    mapping (bytes32 => bool) public queuedTransactions;

    constructor(address admin_, uint delay_) public {
        if (delay_ < MINIMUM_DELAY) revert BadDelay();
        if (delay_ > MAXIMUM_DELAY) revert BadDelay();

        admin = admin_;
        delay = delay_;
    }

    fallback() external payable { }

    function setDelay(uint delay_) public {
        if (msg.sender != address(this)) revert Unauthorized();
        if (delay_ < MINIMUM_DELAY) revert BadDelay();
        if (delay_ > MAXIMUM_DELAY) revert BadDelay();
        delay = delay_;

        emit NewDelay(delay);
    }

    function acceptAdmin() public {
        if (msg.sender != pendingAdmin) revert Unauthorized();
        admin = msg.sender;
        pendingAdmin = address(0);

        emit NewAdmin(admin);
    }

    function setPendingAdmin(address pendingAdmin_) public {
        if (msg.sender != address(this)) revert Unauthorized();
        pendingAdmin = pendingAdmin_;

        emit NewPendingAdmin(pendingAdmin);
    }

    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public returns (bytes32) {
        if (msg.sender != admin) revert Unauthorized();
        if (eta < (getBlockTimestamp() + delay)) revert BadETA();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data, eta);
        return txHash;
    }

    function cancelTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public {
        if (msg.sender != admin) revert Unauthorized();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data, eta);
    }

    function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public payable returns (bytes memory) {
        if (msg.sender != admin) revert Unauthorized();

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        if (!queuedTransactions[txHash]) revert TransactionNotQueued();
        if (getBlockTimestamp() < eta) revert TransactionNotReady();
        if (getBlockTimestamp() > (eta + GRACE_PERIOD)) revert TransactionExpired();

        queuedTransactions[txHash] = false;

        bytes memory callData;

        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        if (!success) revert TransactionReverted();

        emit ExecuteTransaction(txHash, target, value, signature, data, eta);

        return returnData;
    }

    function getBlockTimestamp() internal view returns (uint) {
        return block.timestamp;
    }
}
