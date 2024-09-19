// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

/**
* @title MarketUpdateTimelock
* @notice This contract allows for the execution of transactions after a delay and a proposal mechanism.
* @dev This contract is used for the market updates. The market updates are proposed by the marketAdmin.
* Few important points to note:
* 1) The call to queue, cancel, and execute transaction functions should come from the marketUpdateProposer.
* 2) The marketUpdateProposer can only be set by the governor.
*
*/

contract MarketUpdateTimelock {
    uint public constant GRACE_PERIOD = 14 days;
    uint public constant MINIMUM_DELAY = 2 days;
    uint public constant MAXIMUM_DELAY = 30 days;

    address public governor;
    address public marketUpdateProposer;
    uint public delay;

    mapping(bytes32 => bool) public queuedTransactions;

    event SetGovernor(address indexed oldGovernor, address indexed newGovernor);
    event SetMarketUpdateProposer(address indexed oldMarketAdmin, address indexed newMarketAdmin);
    event SetDelay(uint indexed newDelay);
    event CancelTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data, uint eta);
    event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data, uint eta);
    event QueueTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta);
    
    constructor(address governor_, uint delay_) public {
        require(delay_ >= MINIMUM_DELAY, "MarketUpdateTimelock::constructor: Delay must exceed minimum delay.");
        require(delay_ <= MAXIMUM_DELAY, "MarketUpdateTimelock::setDelay: Delay must not exceed maximum delay.");

        governor = governor_;
        delay = delay_;
    }

    fallback() external payable { }


    function setDelay(uint delay_) public {
        require(msg.sender == governor, "MarketUpdateTimelock::setDelay: Call must come from the Main Governor Timelock.");
        require(delay_ >= MINIMUM_DELAY, "MarketUpdateTimelock::setDelay: Delay must exceed minimum delay.");
        require(delay_ <= MAXIMUM_DELAY, "MarketUpdateTimelock::setDelay: Delay must not exceed maximum delay.");
        delay = delay_;

        emit SetDelay(delay);
    }

    function setGovernor(address newGovernor) public {
        require(msg.sender == governor, "MarketUpdateTimelock::setGovernor: Call must come from governor.");
        address oldGovernor = governor;
        governor = newGovernor;
        emit SetGovernor(oldGovernor, newGovernor);
    }

    function setMarketUpdateProposer(address newMarketUpdateProposer) external {
        require(msg.sender == governor, "MarketUpdateTimelock::setMarketUpdateProposer: Call must come from governor.");
        address oldMarketUpdateProposer = marketUpdateProposer;
        marketUpdateProposer = newMarketUpdateProposer;
        emit SetMarketUpdateProposer(oldMarketUpdateProposer, newMarketUpdateProposer);
    }

    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public returns (bytes32) {
        require(msg.sender == marketUpdateProposer, "MarketUpdateTimelock::queueTransaction: Call must come from marketUpdateProposer.");
        require(eta >= getBlockTimestamp() + delay, "MarketUpdateTimelock::queueTransaction: Estimated execution block must satisfy delay.");

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data, eta);
        return txHash;
    }

    function cancelTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public {
        require(msg.sender == marketUpdateProposer, "MarketUpdateTimelock::cancelTransaction: Call must come from marketUpdateProposer.");
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data, eta);
    }

    function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public payable returns (bytes memory) {
        require(msg.sender == marketUpdateProposer, "MarketUpdateTimelock::executeTransaction: Call must come from marketUpdateProposer.");
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        require(queuedTransactions[txHash], "MarketUpdateTimelock::executeTransaction: Transaction hasn't been queued.");
        require(getBlockTimestamp() >= eta, "MarketUpdateTimelock::executeTransaction: Transaction hasn't surpassed time lock.");
        require(getBlockTimestamp() <= eta + GRACE_PERIOD, "MarketUpdateTimelock::executeTransaction: Transaction is stale.");

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
