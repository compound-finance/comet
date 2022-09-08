// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../ITimelock.sol";

contract BridgeTimelock is ITimelock {
    event NewGuardian(address indexed newGuardian);

    uint public constant GRACE_PERIOD = 14 days;
    uint public constant MINIMUM_DELAY = 2 days;
    uint public constant MAXIMUM_DELAY = 30 days;

    address public admin; // aka the bridge receiever
    address public pendingAdmin;
    address public guardian;
    uint public delay;

    mapping (bytes32 => bool) public queuedTransactions;

    constructor(address admin_, address guardian_, uint delay_) public {
        require(delay_ >= MINIMUM_DELAY, "BridgeTimelock::constructor: Delay must exceed minimum delay.");
        require(delay_ <= MAXIMUM_DELAY, "BridgeTimelock::setDelay: Delay must not exceed maximum delay.");

        // XXX guardian checks?

        admin = admin_;
        guardian = guardian_;
        delay = delay_;
    }

    fallback() external payable { }

    function setDelay(uint delay_) public {
        require(msg.sender == address(this), "BridgeTimelock::setDelay: Call must come from BridgeTimelock.");
        require(delay_ >= MINIMUM_DELAY, "BridgeTimelock::setDelay: Delay must exceed minimum delay.");
        require(delay_ <= MAXIMUM_DELAY, "BridgeTimelock::setDelay: Delay must not exceed maximum delay.");
        delay = delay_;

        emit NewDelay(delay);
    }

    function acceptAdmin() public {
        require(msg.sender == pendingAdmin, "BridgeTimelock::acceptAdmin: Call must come from pendingAdmin.");
        admin = msg.sender;
        pendingAdmin = address(0);

        emit NewAdmin(admin);
    }

    function setPendingAdmin(address pendingAdmin_) public {
        require(msg.sender == address(this), "BridgeTimelock::setPendingAdmin: Call must come from BridgeTimelock.");
        pendingAdmin = pendingAdmin_;

        emit NewPendingAdmin(pendingAdmin);
    }

    function setGuardian(address newGuardian) public {
        require(msg.sender == address(this), "BridgeTimelock::setGuardian: Call must come from BridgeTimelock.");
        guardian = newGuardian;

        emit NewGuardian(guardian);
    }

    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public returns (bytes32) {
        require(msg.sender == admin, "BridgeTimelock::queueTransaction: Call must come from admin.");
        require(eta >= (getBlockTimestamp() + delay), "BridgeTimelock::queueTransaction: Estimated execution block must satisfy delay.");

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data, eta);
        return txHash;
    }

    function cancelTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public {
        require(msg.sender == guardian, "BridgeTimelock::cancelTransaction: Call must come from guardian.");

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data, eta);
    }

    function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public payable returns (bytes memory) {
        require(msg.sender == admin, "BridgeTimelock::executeTransaction: Call must come from admin."); // should anyone be able to execute?

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        require(queuedTransactions[txHash], "BridgeTimelock::executeTransaction: Transaction hasn't been queued.");
        require(getBlockTimestamp() >= eta, "BridgeTimelock::executeTransaction: Transaction hasn't surpassed time lock.");
        require(getBlockTimestamp() <= (eta + GRACE_PERIOD), "BridgeTimelock::executeTransaction: Transaction is stale.");

        queuedTransactions[txHash] = false;

        bytes memory callData;

        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        require(success, "BridgeTimelock::executeTransaction: Transaction execution reverted.");

        emit ExecuteTransaction(txHash, target, value, signature, data, eta);

        return returnData;
    }

    function getBlockTimestamp() internal view returns (uint) {
        return block.timestamp;
    }
}
