// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

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
  *  - Instead of allowing voting by tokens, the system is run by a set of governors with unlimited power. Anyone in this set should be able to add or remove other governors (it's test-net).
  *  - There is no voting - everything passes by will of any governor.
  *  - The ABI for proposing, queueing, executing should be identical to main-net. The execution should, similarly, go through a simple test-net Timelock.
  *  - ABI:
  *    - function propose(address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas, string memory description) public returns (uint)
  *    - function queue(uint proposalId) public
  *    - function execute(uint proposalId) public payable
 */
contract GovernorSimple {

    /// @notice An event emitted when a new proposal is created
    event ProposalCreated(uint id, address proposer, address[] targets, uint[] values, string[] signatures, bytes[] calldatas, uint startBlock, string description);

    /// @notice An event emitted when a vote has been cast on a proposal
    /// @param voter The address which casted a vote
    /// @param proposalId The proposal id which was voted on
    /// @param support Support value for the vote. 0=against, 1=for, 2=abstain
    /// @param votes Number of votes which were cast by the voter
    /// @param reason The reason given for the vote by the voter
    event VoteCast(address indexed voter, uint proposalId, uint8 support, uint votes, string reason);

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

    /// @notice The list of governors that can propose, cancel, queue, and execute proposals
    address[] public governors;

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

    constructor(address timelock_, address[] memory governors_) {
        // XXX use custom errors
        require(address(timelock) == address(0), "GovernorBravo::initialize: can only initialize once");
        // XXX governor can't be empty?
        timelock = TimelockInterface(timelock_);
        governors = governors_; // XXX consider using a mapping instead
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
        require(isGovernor(msg.sender), "GovernorBravo::propose: only governors can propose");
        require(targets.length == values.length && targets.length == signatures.length && targets.length == calldatas.length, "GovernorBravo::propose: proposal function information arity mismatch");
        require(targets.length != 0, "GovernorBravo::propose: must provide actions");
        require(targets.length <= proposalMaxOperations, "GovernorBravo::propose: too many actions");

        uint startBlock = block.number;

        proposalCount++;
        Proposal memory newProposal = Proposal({
            id: proposalCount,
            proposer: msg.sender,
            targets: targets,
            values: values,
            signatures: signatures,
            calldatas: calldatas,
            startBlock: block.number,
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
        require(isGovernor(msg.sender), "GovernorBravo::propose: only governors can propose");
        require(state(proposalId) == ProposalState.Active, "GovernorBravo::queue: proposal can only be queued if it is active");
        
        Proposal storage proposal = proposals[proposalId];
        proposal.queued = true;
        for (uint i = 0; i < proposal.targets.length; i++) {
            queueOrRevertInternal(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i]);
        }
        emit ProposalQueued(proposalId);
    }

    function queueOrRevertInternal(address target, uint value, string memory signature, bytes memory data) internal {
        require(!timelock.queuedTransactions(keccak256(abi.encode(target, value, signature, data))), "GovernorBravo::queueOrRevertInternal: identical proposal action already queued at eta");
        timelock.queueTransaction(target, value, signature, data);
    }

    /**
      * @notice Executes a queued proposal if eta has passed
      * @param proposalId The id of the proposal to execute
      */
    function execute(uint proposalId) external payable {
        require(isGovernor(msg.sender), "GovernorBravo::propose: only governors can propose");
        require(state(proposalId) == ProposalState.Queued, "GovernorBravo::execute: proposal can only be executed if it is queued");
        
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
        require(isGovernor(msg.sender), "GovernorBravo::propose: only governors can propose");
        require(state(proposalId) != ProposalState.Executed, "GovernorBravo::cancel: cannot cancel executed proposal");

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
        require(proposalCount >= proposalId, "GovernorBravo::state: invalid proposal id");
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
    function isGovernor(address account) internal view returns (bool) {
        for (uint i = 0; i < governors.length; i++) {
            if (governors[i] == account) {
                return true;
            }
        }
        return false;
    }
}