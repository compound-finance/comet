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

    /**
     * @notice Sets a new delay for executing transactions
     * @param delay_ The new delay in seconds
     */
    function setDelay(uint delay_) public {
        require(msg.sender == governor, "MarketUpdateTimelock::setDelay: Call must come from the Main Governor Timelock.");
        require(delay_ >= MINIMUM_DELAY, "MarketUpdateTimelock::setDelay: Delay must exceed minimum delay.");
        require(delay_ <= MAXIMUM_DELAY, "MarketUpdateTimelock::setDelay: Delay must not exceed maximum delay.");
        delay = delay_;

        emit SetDelay(delay);
    }

    /**
     * @notice Transfers governor role to a new address
     * @param newGovernor The address of the new governor
     */
    function setGovernor(address newGovernor) public {
        require(msg.sender == governor, "MarketUpdateTimelock::setGovernor: Call must come from governor.");
        address oldGovernor = governor;
        governor = newGovernor;
        emit SetGovernor(oldGovernor, newGovernor);
    }

    /**
     * @notice Sets a new market update proposer
     * @param newMarketUpdateProposer The address of the new proposer
     */
    function setMarketUpdateProposer(address newMarketUpdateProposer) external {
        require(msg.sender == governor, "MarketUpdateTimelock::setMarketUpdateProposer: Call must come from governor.");
        address oldMarketUpdateProposer = marketUpdateProposer;
        marketUpdateProposer = newMarketUpdateProposer;
        emit SetMarketUpdateProposer(oldMarketUpdateProposer, newMarketUpdateProposer);
    }

    /**
     * @notice Queues a transaction for execution
     * @param target The address of the target contract
     * @param value The ETH value to send with the transaction
     * @param signature The function signature to call
     * @param data The calldata for the function call
     * @param eta The time when the transaction can be executed
     * @return The hash of the queued transaction
     */
    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public returns (bytes32) {
        require(msg.sender == marketUpdateProposer, "MarketUpdateTimelock::queueTransaction: Call must come from marketUpdateProposer.");
        require(eta >= getBlockTimestamp() + delay, "MarketUpdateTimelock::queueTransaction: Estimated execution block must satisfy delay.");

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data, eta);
        return txHash;
    }

    /**
     * @notice Cancels a previously queued transaction
     * @param target The address of the target contract
     * @param value The ETH value sent with the transaction
     * @param signature The function signature
     * @param data The calldata for the function
     * @param eta The time when the transaction was scheduled to execute
     */
    function cancelTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public {
        require(msg.sender == marketUpdateProposer, "MarketUpdateTimelock::cancelTransaction: Call must come from marketUpdateProposer.");
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data, eta);
    }

    /**
     * @notice Executes a queued transaction
     * @param target The address of the target contract
     * @param value The ETH value to send with the transaction
     * @param signature The function signature to call
     * @param data The calldata for the function call
     * @param eta The time when the transaction was scheduled to execute
     * @return The return data from the executed transaction
     */
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
