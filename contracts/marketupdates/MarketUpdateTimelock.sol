// SPDX-License-Identifier: BSD-3-Clause
pragma solidity ^0.8.10;

import "./SafeMath.sol";

/*

Right now admin and marketUpdateProposer can cancel one another's transactions, but
this is not a realistic scenario as admin is a main-governor-timelock which will not be
queuing, executing, or cancelling transactions. So we are not handling or testing it.
*/
contract MarketUpdateTimelock {
    using SafeMath for uint;

    event NewAdmin(address indexed oldAdmin, address indexed newAdmin);
    event NewMarketUpdateProposer(address indexed oldMarketAdmin, address indexed newMarketAdmin);
    event NewDelay(uint indexed newDelay);
    event CancelTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data, uint eta);
    event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data, uint eta);
    event QueueTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta);

    uint public constant GRACE_PERIOD = 14 days;
    uint public constant MINIMUM_DELAY = 0 days;
    uint public constant MAXIMUM_DELAY = 30 days;

    address public admin;
    address public marketUpdateProposer;
    uint public delay;

    mapping (bytes32 => bool) public queuedTransactions;

    modifier adminOrMarketUpdater {
        require(msg.sender == admin || msg.sender == marketUpdateProposer, "MarketUpdateTimelock::Unauthorized: call must come from admin or marketAdmin");
        _;
    }
    
    constructor(address admin_, uint delay_) public {
        require(delay_ >= MINIMUM_DELAY, "MarketUpdateTimelock::constructor: Delay must exceed minimum delay.");
        require(delay_ <= MAXIMUM_DELAY, "MarketUpdateTimelock::setDelay: Delay must not exceed maximum delay.");

        admin = admin_;
        delay = delay_;
    }

    fallback() external payable { }


    function setDelay(uint delay_) public {
        require(msg.sender == address(this), "MarketUpdateTimelock::setDelay: Call must come from Timelock.");
        require(delay_ >= MINIMUM_DELAY, "MarketUpdateTimelock::setDelay: Delay must exceed minimum delay.");
        require(delay_ <= MAXIMUM_DELAY, "MarketUpdateTimelock::setDelay: Delay must not exceed maximum delay.");
        delay = delay_;

        emit NewDelay(delay);
    }

    function setAdmin(address newAdmin) public {
        require(msg.sender == admin, "MarketUpdateTimelock::setAdmin: Call must come from admin.");
        address oldAdmin = admin;
        admin = newAdmin;
        emit NewAdmin(oldAdmin, newAdmin);
    }

    function setMarketUpdateProposer(address newMarketUpdateProposer) external {
        require(msg.sender == admin, "MarketUpdateTimelock::setMarketUpdateProposer: Call must come from admin.");
        address oldMarketUpdateProposer = marketUpdateProposer;
        marketUpdateProposer = newMarketUpdateProposer;
        emit NewMarketUpdateProposer(oldMarketUpdateProposer, newMarketUpdateProposer);
    }

    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public adminOrMarketUpdater returns (bytes32) {
        require(eta >= getBlockTimestamp().add(delay), "MarketUpdateTimelock::queueTransaction: Estimated execution block must satisfy delay.");

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data, eta);
        return txHash;
    }

    function cancelTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public adminOrMarketUpdater {
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data, eta);
    }

    function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public payable adminOrMarketUpdater returns (bytes memory) {
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        require(queuedTransactions[txHash], "MarketUpdateTimelock::executeTransaction: Transaction hasn't been queued.");
        require(getBlockTimestamp() >= eta, "MarketUpdateTimelock::executeTransaction: Transaction hasn't surpassed time lock.");
        require(getBlockTimestamp() <= eta.add(GRACE_PERIOD), "MarketUpdateTimelock::executeTransaction: Transaction is stale.");

        queuedTransactions[txHash] = false;

        bytes memory callData;

        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        // solium-disable-next-line security/no-call-value
        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        require(success, "MarketUpdateTimelock::executeTransaction: Transaction execution reverted.");

        emit ExecuteTransaction(txHash, target, value, signature, data, eta);

        return returnData;
    }

    function getBlockTimestamp() internal view returns (uint) {
        // solium-disable-next-line security/no-block-members
        return block.timestamp;
    }
}
