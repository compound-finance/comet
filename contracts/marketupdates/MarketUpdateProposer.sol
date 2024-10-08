// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./../ITimelock.sol";

/**
* @title MarketUpdateProposer
* @notice This contract allows for the creation of proposals that can be executed by the timelock
* @dev This contract is used to propose market updates
* Few important points to note:
* 1) The marketAdmin can propose updates. The marketAdmin can be set by the governor. marketAdmin will be a multi-sig.
* 2) Here governor is the main-governor-timelock. This terminology(using governor as variable for timelock) is for
*    consistency with Configurator.sol.
* 3) If marketAdmin/multi-sig is compromised, the new marketAdmin can be set by the governor.
* 4) While the marketAdmin/multi-sig is compromised, the new marketAdmin can propose updates. But those updates will be
*    sent to timelock and can be paused by the marketAdminPauseGuardian Configurator and CometProxyAdmin.
* 5) The proposalGuardian can also be used for the same purpose and can cancel the proposal.
*
*
*/
contract MarketUpdateProposer {
    struct MarketUpdateProposal {
        /// @notice Unique id for looking up a proposal
        uint id;

        /// @notice Creator of the proposal
        address proposer;

        /// @notice The timestamp that the proposal will be available for execution, set once the vote succeeds
        uint eta;

        /// @notice the ordered list of target addresses for calls to be made
        address[] targets;

        /// @notice The ordered list of values (i.e. msg.value) to be passed to the calls to be made
        uint[] values;

        /// @notice The ordered list of function signatures to be called
        string[] signatures;

        /// @notice The ordered list of calldata to be passed to each call
        bytes[] calldatas;

        /// @notice Flag marking whether the proposal has been canceled
        bool canceled;

        /// @notice Flag marking whether the proposal has been executed
        bool executed;
    }

    enum ProposalState {
        Canceled,
        Queued,
        Executed,
        Expired
    }

    address public governor;
    address public proposalGuardian;
    address public marketAdmin;
    ITimelock public timelock;

    /// @notice The official record of all proposals ever proposed
    mapping(uint => MarketUpdateProposal) public proposals;
    /// @notice The total number of proposals
    uint public proposalCount;

    /// @notice The initial proposal ID, set when the contract is deployed
    uint public constant INITIAL_PROPOSAL_ID = 0;
    
    /// @notice The maximum number of actions that can be included in a proposal
    uint public constant PROPOSAL_MAX_OPERATIONS = 20; // 20 actions

    /// @notice An event emitted when a new proposal is created
    event MarketUpdateProposalCreated(uint id, address proposer, address[] targets, uint[] values, string[] signatures, bytes[] calldatas, string description);
    event MarketUpdateProposalExecuted(uint id);
    event MarketUpdateProposalCancelled(uint id);
    event SetProposalGuardian(address indexed oldProposalGuardian, address indexed newProposalGuardian);
    event SetMarketAdmin(address indexed oldAdmin, address indexed newAdmin);
    event SetGovernor(address indexed oldGovernor, address indexed newGovernor);

    error Unauthorized();
    error InvalidAddress();

    constructor(address governor_, address marketAdmin_, address proposalGuardian_, ITimelock timelock_) public {
        if (governor_ == address(0) || marketAdmin_ == address(0) || address(timelock_) == address(0)) revert InvalidAddress();
        governor = governor_;
        marketAdmin = marketAdmin_;
        proposalGuardian = proposalGuardian_;
        timelock = timelock_;
    }
    
    /**
     * @notice Transfers the governor rights to a new address
     * @dev Can only be called by the governor. Reverts with Unauthorized if the caller is not the governor.
     * Emits an event with the old and new governor addresses.
     * @param newGovernor The address of the new governor.
     */
    function setGovernor(address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();
        if (address(newGovernor) == address(0)) revert InvalidAddress();
        
        address oldGovernor = governor;
        governor = newGovernor;
        emit SetGovernor(oldGovernor, newGovernor);
    }
    
    /**
     * @notice Sets a new proposalGuardian.
     * @dev Can only be called by the governor. Reverts with Unauthorized if the caller is not the owner.
     * Emits an event with the old and new proposalGuardian addresses.
     * Note that there is no enforced zero address check on `newProposalGuardian` as it may be a deliberate choice
     * to assign the zero address in certain scenarios. This design allows flexibility if the zero address
     * is intended to represent a specific state, such as temporarily disabling the proposalGuardian.
     * @param newProposalGuardian The address of the new market admin proposalGuardian.
     */
    function setProposalGuardian(address newProposalGuardian) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldProposalGuardian = proposalGuardian;
        proposalGuardian = newProposalGuardian;
        emit SetProposalGuardian(oldProposalGuardian, newProposalGuardian);
    }

    /**
     * @notice Sets a new market admin.
     * @dev Can only be called by the governor. Reverts with Unauthorized if the caller is not the governor.
     * Emits an event with the old and new market admin addresses.
     * Note that there is no enforced zero address check on `newMarketAdmin` as it may be a deliberate choice
     * to assign the zero address in certain scenarios. This design allows flexibility if the zero address
     * is intended to represent a specific state, such as temporarily disabling the market admin role.
     * @param newMarketAdmin The address of the new market admin.
     */
    function setMarketAdmin(address newMarketAdmin) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldMarketAdmin = marketAdmin;
        marketAdmin = newMarketAdmin;
        emit SetMarketAdmin(oldMarketAdmin, newMarketAdmin);
    }
    
    /**
     * @notice Function used to propose a new proposal for market updates
     * @dev Can only be called by the market admin. Reverts with Unauthorized if the caller is not the market admin
     * The function requires the provided arrays to have the same length and at least one action
     * Emits a MarketUpdateProposalCreated event with the proposal details
     * @param targets Target addresses for proposal calls
     * @param values Eth values for proposal calls
     * @param signatures Function signatures for proposal calls
     * @param calldatas Calldatas for proposal calls
     * @param description String description of the proposal
     * @return Proposal id of new proposal
     */
    function propose(address[] memory targets, uint[] memory values, string[] memory signatures, bytes[] memory calldatas, string memory description) public returns (uint) {
        if (msg.sender != marketAdmin) revert Unauthorized();
        require(targets.length == values.length && targets.length == signatures.length && targets.length == calldatas.length, "MarketUpdateProposer::propose: proposal function information arity mismatch");
        require(targets.length != 0, "MarketUpdateProposer::propose: must provide actions");
        require(targets.length <= PROPOSAL_MAX_OPERATIONS, "MarketUpdateProposer::propose: too many actions");
        
        proposalCount++;
        uint newProposalID = proposalCount;
        MarketUpdateProposal storage newProposal = proposals[newProposalID];

        require(newProposal.id == 0, "MarketUpdateProposer::propose: ProposalID collision");
        uint eta = block.timestamp + timelock.delay();
        newProposal.id = newProposalID;
        newProposal.proposer = msg.sender;
        newProposal.eta = eta;
        newProposal.targets = targets;
        newProposal.values = values;
        newProposal.signatures = signatures;
        newProposal.calldatas = calldatas;
        newProposal.canceled = false;
        newProposal.executed = false;

        emit MarketUpdateProposalCreated(newProposal.id, msg.sender, targets, values, signatures, calldatas, description);

        for (uint i = 0; i < newProposal.targets.length; i++) {
            queueOrRevertInternal(newProposal.targets[i], newProposal.values[i], newProposal.signatures[i], newProposal.calldatas[i], eta);
        }

        return newProposal.id;
    }

    function queueOrRevertInternal(address target, uint value, string memory signature, bytes memory data, uint eta) internal {
        require(!timelock.queuedTransactions(keccak256(abi.encode(target, value, signature, data, eta))), "MarketUpdateProposer::queueOrRevertInternal: identical proposal action already queued at eta");
        timelock.queueTransaction(target, value, signature, data, eta);
    }

    /**
      * @notice Executes a queued proposal if eta has passed
      * @param proposalId The id of the proposal to execute
      */
    function execute(uint proposalId) external payable {
        if (msg.sender != marketAdmin) revert Unauthorized();
        require(state(proposalId) == ProposalState.Queued, "MarketUpdateProposer::execute: proposal can only be executed if it is queued");
        MarketUpdateProposal storage proposal = proposals[proposalId];
        proposal.executed = true;
        for (uint i = 0; i < proposal.targets.length; i++) {
            timelock.executeTransaction{value: proposal.values[i]}(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i], proposal.eta);
        }
        emit MarketUpdateProposalExecuted(proposalId);
    }

    /**
      * @notice Cancels a proposal only if sender is the proposer, proposalGuardian, or marketAdmin, and the proposal is not already executed
      * @param proposalId The id of the proposal to cancel
      */
    function cancel(uint proposalId) external {
        if (msg.sender != governor && msg.sender != proposalGuardian && msg.sender != marketAdmin) revert Unauthorized();
        require(state(proposalId) != ProposalState.Executed, "MarketUpdateProposer::cancel: cannot cancel executed proposal");

        MarketUpdateProposal storage proposal = proposals[proposalId];

        proposal.canceled = true;
        for (uint i = 0; i < proposal.targets.length; i++) {
            timelock.cancelTransaction(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i], proposal.eta);
        }

        emit MarketUpdateProposalCancelled(proposalId);
    }

    /**
     * @notice Gets the state of a proposal
     * @param proposalId The id of the proposal
     * @return Proposal state
     */
    function state(uint proposalId) public view returns (ProposalState) {
        require(proposalCount >= proposalId && proposalId > INITIAL_PROPOSAL_ID, "MarketUpdateProposer::state: invalid proposal id");
        MarketUpdateProposal storage proposal = proposals[proposalId];
        if (proposal.canceled) {
            return ProposalState.Canceled;
        } else if (proposal.executed) {
            return ProposalState.Executed;
        } else if (block.timestamp >= (proposal.eta + timelock.GRACE_PERIOD())) {
            return ProposalState.Expired;
        } else {
            return ProposalState.Queued;
        }
    }


    /**
     * @notice Get details of a proposal by its id
     * @param proposalId The id of the proposal
     * @return id The id of the proposal
     * @return proposer The address of the proposer
     * @return eta The estimated time at which the proposal can be executed
     * @return targets targets of the proposal actions
     * @return values ETH values of the proposal actions
     * @return signatures signatures of the proposal actions
     * @return calldatas calldatas of the proposal actions
     * @return canceled boolean indicating whether the proposal has been canceled
     * @return executed boolean indicating whether the proposal has been executed
     */
    function getProposal(uint proposalId) public view
        returns (
            uint,
            address,
            uint,
            address[] memory,
            uint[] memory,
            string[] memory,
            bytes[] memory,
            bool,
            bool
        )
    {
        MarketUpdateProposal storage proposal = proposals[proposalId];
        return (
            proposal.id,
            proposal.proposer,
            proposal.eta,
            proposal.targets,
            proposal.values,
            proposal.signatures,
            proposal.calldatas,
            proposal.canceled,
            proposal.executed
        );
    }
}
