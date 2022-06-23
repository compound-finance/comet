// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

interface TimelockInterface {
    function queuedTransactions(bytes32 hash) external view returns (bool);
    function queueTransaction(address target, uint value, string calldata signature, bytes calldata data) external returns (bytes32);
    function cancelTransaction(address target, uint value, string calldata signature, bytes calldata data) external;
    function executeTransaction(address target, uint value, string calldata signature, bytes calldata data) external payable returns (bytes memory);
    function executeTransactions(address[] calldata targets, uint[] calldata values, string[] calldata signatures, bytes[] calldata data) external payable;
}

/**
  * GovSimple:
  *  - A system similar to Compound's Governor{Alpha, Bravo, Charlie} but just for test-net.
  *  - Instead of allowing voting by tokens, the system is run by a set of admins with unlimited power. Anyone in this set should be able to add or remove other admins (it's test-net).
  *  - There is no voting - everything passes by will of any admin.
  *  - The ABI for proposing, queueing, executing should be identical to main-net. The execution should, similarly, go through a simple test-net Timelock.
  *  - ABI:
  *    - function propose(address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas, string memory description) public returns (uint)
  *    - function queue(uint proposalId) public
  *    - function execute(uint proposalId) public payable
 */
contract GovernorSimple {

    /// @notice An event emitted when a new proposal is created
    event ProposalCreated(uint id, address proposer, address[] targets, uint[] values, string[] signatures, bytes[] calldatas, uint startBlock, string description);

    /// @notice An event emitted when a proposal has been canceled
    event ProposalCanceled(uint id);

    /// @notice An event emitted when a proposal has been queued in the Timelock
    event ProposalQueued(uint id);

    /// @notice An event emitted when a proposal has been executed in the Timelock
    event ProposalExecuted(uint id);

    /// @notice The maximum number of actions that can be included in a proposal
    uint public constant proposalMaxOperations = 10; // 10 actions

    /// @notice The timelock
    TimelockInterface public timelock;

    /// @notice The list of admins that can propose, cancel, queue, and execute proposals
    address[] public admins;

    /// @notice The total number of proposals
    uint public proposalCount;

    /// @notice The official record of all proposals ever proposed
    mapping (uint => Proposal) public proposals;

    struct Proposal {
        /// @notice Unique id for looking up a proposal
        uint id;

        /// @notice Creator of the proposal
        address proposer;

        /// @notice the ordered list of target addresses for calls to be made
        address[] targets;

        /// @notice The ordered list of values (i.e. msg.value) to be passed to the calls to be made
        uint[] values;

        /// @notice The ordered list of function signatures to be called
        string[] signatures;

        /// @notice The ordered list of calldata to be passed to each call
        bytes[] calldatas;

        /// @notice The block at which voting begins: holders must delegate their votes prior to this block
        uint startBlock;

        /// @notice Flag marking whether the proposal has been canceled
        bool canceled;

        /// @notice Flag marking whether the proposal has been queued
        bool queued;

        /// @notice Flag marking whether the proposal has been executed
        bool executed;
    }

    /// @notice Possible states that a proposal may be in
    enum ProposalState {
        Active,
        Canceled,
        Queued,
        Executed
    }

    /**
      * @notice Initialize the initial contract storage
      * @param timelock_ The address of the Timelock
      * @param admins_ The admins of governor
      */
    function initialize(address timelock_, address[] memory admins_) external {
        require(address(timelock) == address(0), "GovernorSimple::initialize: can only initialize once");
        timelock = TimelockInterface(timelock_);
        admins = admins_;
    }

    /**
      * @notice Function used to propose a new proposal. Sender must be a governor
      * @param targets Target addresses for proposal calls
      * @param values Eth values for proposal calls
      * @param signatures Function signatures for proposal calls
      * @param calldatas Calldatas for proposal calls
      * @param description String description of the proposal
      * @return Proposal id of new proposal
      */
    function propose(address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas, string memory description) public returns (uint) {
        require(isAdmin(msg.sender), "GovernorSimple::propose: only governors can propose");
        require(targets.length == values.length && targets.length == signatures.length && targets.length == calldatas.length, "GovernorSimple::propose: proposal function information arity mismatch");
        require(targets.length != 0, "GovernorSimple::propose: must provide actions");
        require(targets.length <= proposalMaxOperations, "GovernorSimple::propose: too many actions");

        uint startBlock = block.number;

        proposalCount++;
        Proposal memory newProposal = Proposal({
            id: proposalCount,
            proposer: msg.sender,
            targets: targets,
            values: values,
            signatures: signatures,
            calldatas: calldatas,
            startBlock: startBlock,
            canceled: false,
            queued: false,
            executed: false
        });

        proposals[newProposal.id] = newProposal;

        emit ProposalCreated(newProposal.id, msg.sender, targets, values, signatures, calldatas, startBlock, description);
        return newProposal.id;
    }

    /**
      * @notice Queues a proposal of state active
      * @param proposalId The id of the proposal to queue
      */
    function queue(uint proposalId) external {
        require(isAdmin(msg.sender), "GovernorSimple::queue: only governors can queue");
        require(state(proposalId) == ProposalState.Active, "GovernorSimple::queue: proposal can only be queued if it is active");

        Proposal storage proposal = proposals[proposalId];
        proposal.queued = true;
        for (uint i = 0; i < proposal.targets.length; i++) {
            queueOrRevertInternal(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i]);
        }
        emit ProposalQueued(proposalId);
    }

    function queueOrRevertInternal(address target, uint value, string memory signature, bytes memory data) internal {
        require(!timelock.queuedTransactions(keccak256(abi.encode(target, value, signature, data))), "GovernorSimple::queueOrRevertInternal: identical proposal action already queued at eta");
        timelock.queueTransaction(target, value, signature, data);
    }

    /**
      * @notice Executes a queued proposal if eta has passed
      * @param proposalId The id of the proposal to execute
      */
    function execute(uint proposalId) external payable {
        require(isAdmin(msg.sender), "GovernorSimple::execute: only governors can execute");
        require(state(proposalId) == ProposalState.Queued, "GovernorSimple::execute: proposal can only be executed if it is queued");

        Proposal storage proposal = proposals[proposalId];
        proposal.queued = false;
        proposal.executed = true;
        for (uint i = 0; i < proposal.targets.length; i++) {
            timelock.executeTransaction{ value:proposal.values[i] }(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i]);
        }
        emit ProposalExecuted(proposalId);
    }

    /**
      * @notice Cancels a proposal only if sender is a governor
      * @param proposalId The id of the proposal to cancel
      */
    function cancel(uint proposalId) external {
        require(isAdmin(msg.sender), "GovernorSimple::cancel: only governors can cancel");
        require(state(proposalId) != ProposalState.Executed, "GovernorSimple::cancel: cannot cancel executed proposal");

        Proposal storage proposal = proposals[proposalId];
        proposal.canceled = true;
        for (uint i = 0; i < proposal.targets.length; i++) {
            timelock.cancelTransaction(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i]);
        }
        emit ProposalCanceled(proposalId);
    }

    /**
      * @notice Gets actions of a proposal
      * @param proposalId the id of the proposal
      */
    function getActions(uint proposalId) external view returns (address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas) {
        Proposal storage p = proposals[proposalId];
        return (p.targets, p.values, p.signatures, p.calldatas);
    }

    /**
      * @notice Gets the state of a proposal
      * @param proposalId The id of the proposal
      * @return Proposal state
      */
    function state(uint proposalId) public view returns (ProposalState) {
        require(proposalCount >= proposalId, "GovernorSimple::state: invalid proposal id");
        Proposal memory proposal = proposals[proposalId];
        if (proposal.canceled) {
            return ProposalState.Canceled;
        } else if (proposal.queued) {
            return ProposalState.Queued;
        } else if (proposal.executed) {
            return ProposalState.Executed;
        } else {
            return ProposalState.Active;
        }
    }

    /// @notice Checks whether an account is a governor or not
    function isAdmin(address account) public view returns (bool) {
        for (uint i = 0; i < admins.length; i++) {
            if (admins[i] == account) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Add new admin
     * @param newAdminAddress Address of admin to add
     */
    function addAdmin(address newAdminAddress) external {
        require(isAdmin(msg.sender), "GovernorSimple::addAdmin: only governors can add governors");
        admins.push(newAdminAddress);
    }

    /**
     * @notice Remove admin from admin array
     * @param adminAddress Address of admin to remove
     */
    function removeAdmin(address adminAddress) external {
        require(isAdmin(msg.sender), "GovernorSimple::removeAdmin: only governors can remove governors");
        require(msg.sender != adminAddress, "GovernorSimple::removeAdmin: cannot remove self as admin"); // ensure there is always one admin

        bool addressFound = false;

        for (uint i = 0; i < admins.length; i++) {
            if (admins[i] == adminAddress) {
                admins[i] == admins[admins.length - 1];
                addressFound = true;
            }
        }
        if (addressFound) {
            admins.pop();
        }
    }
}