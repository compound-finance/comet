// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @dev Interface for interacting with a Timelock
 */
interface ITimelock {
    event NewAdmin(address indexed newAdmin);
    event NewPendingAdmin(address indexed newPendingAdmin);
    event NewDelay(uint indexed newDelay);
    event CancelTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data, uint eta);
    event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data, uint eta);
    event QueueTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta);

    function GRACE_PERIOD() virtual external view returns (uint);
    function MINIMUM_DELAY() virtual external view returns (uint);
    function MAXIMUM_DELAY() virtual external view returns (uint);

    function admin() virtual external view returns (address);
    function pendingAdmin() virtual external view returns (address);
    function setPendingAdmin(address pendingAdmin_) virtual external;
    function acceptAdmin() virtual external;

    function delay() virtual external view returns (uint);
    function setDelay(uint delay) virtual external;

    function queuedTransactions(bytes32 txHash) virtual external returns (bool);
    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) virtual external returns (bytes32);
    function cancelTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) virtual external;
    function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) virtual external payable returns (bytes memory);
}
