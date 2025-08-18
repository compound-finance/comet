// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./IGovernorBravo.sol";
import "./vendor/Timelock.sol";
import "./vendor/proxy/ERC1967/ERC1967Upgrade.sol";

contract CustomGovernor is IGovernorBravo, ERC1967Upgrade {
    /// @notice The name of this contract
    string public constant name = "Custom Governor";

     /// @notice The address of the governance token (for interface compliance)
    address public token;

     /// @notice The address of the timelock
    Timelock public timelock;

    /// @notice The total number of proposals
    uint public proposalCount;

    /// @notice The maximum number of actions that can be included in a proposal
    uint public constant proposalMaxOperations = 10;

    /// @notice The official record of all proposals ever proposed
    mapping (uint => Proposal) public _proposals;

    /// @notice Proposal details storage
    mapping (uint => address[]) public proposalTargets;
    mapping (uint => uint[]) public proposalValues;
    mapping (uint => bytes[]) public proposalCalldatas;

    /// @notice The latest proposal for each proposer
    mapping (address => uint) public latestProposalIds;

    /// @notice Mapping of admin addresses (set in constructor)
    mapping (address => bool) public admins;

    /// @notice Number of admins required to approve a proposal (immutable)
    uint public immutable multisigThreshold;
    

    /// @notice Mapping of proposal approvals by admins
    mapping (uint => mapping (address => bool)) public proposalApprovals;

    /// @notice Mapping of proposal approval counts
    mapping (uint => uint) public proposalApprovalCounts;

    /// @notice An event emitted when an admin is added or removed
    event GovernorAdminChanged(address admin, bool isAdmin);

    /// @notice An event emitted when an admin approves a proposal
    event ProposalApproved(uint proposalId, address admin);

    /**
     * @notice Constructor to set immutable multisig threshold
     * @param threshold_ The multisig threshold (immutable)
     */
    constructor(uint threshold_) {
        multisigThreshold = threshold_;
    }

    /**
     * @notice Initialize the governor (called by proxy)
     * @param timelock_ The timelock contract address
     * @param token_ The governance token address
     * @param admins_ The array of admin addresses
     */
    function initialize(
        address timelock_,
        address token_,
        address[] memory admins_
    ) external {
        require(timelock == Timelock(payable(0)), "CustomGovernor::initialize: already initialized");
        
        timelock = Timelock(payable(timelock_));
        token = token_;
        
        // Set admins
        for (uint i = 0; i < admins_.length; i++) {
            admins[admins_[i]] = true;
            emit GovernorAdminChanged(admins_[i], true);
        }
    }

    function propose(
        address[] memory targets,
        uint[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public returns (uint) {
        require(admins[msg.sender], "CustomGovernor::propose: only admins can propose");
        require(targets.length == values.length && targets.length == calldatas.length, "CustomGovernor::propose: proposal function information arity mismatch");
        require(targets.length != 0, "CustomGovernor::propose: must provide actions");
        require(targets.length <= proposalMaxOperations, "CustomGovernor::propose: too many actions");

        proposalCount++;
        Proposal memory newProposal = Proposal({
            id: proposalCount,
            proposer: msg.sender,
            eta: 0,
            startBlock: 0, 
            endBlock: 0,   
            forVotes: 0,   
            againstVotes: 0, 
            abstainVotes: 0, 
            canceled: false,
            executed: false
        });

        _proposals[newProposal.id] = newProposal;
        proposalTargets[newProposal.id] = targets;
        proposalValues[newProposal.id] = values;
        proposalCalldatas[newProposal.id] = calldatas;
        latestProposalIds[newProposal.proposer] = newProposal.id;

        // Create signatures array (empty for now)
        string[] memory signatures = new string[](targets.length);

        emit ProposalCreated(newProposal.id, msg.sender, targets, values, signatures, calldatas, 0, 0, description);
        return newProposal.id;
    }

    function queue(uint proposalId) external {
        require(admins[msg.sender], "CustomGovernor::queue: only admins can queue");
        require(state(proposalId) == IGovernorBravo.ProposalState.Succeeded, "CustomGovernor::queue: proposal can only be queued if it is succeeded");
        
        // Check if proposal has enough approvals
        require(proposalApprovalCounts[proposalId] >= multisigThreshold, "CustomGovernor::queue: not enough approvals");
        
        Proposal storage proposal = _proposals[proposalId];
        uint eta = block.timestamp + timelock.delay();
        address[] memory targets = proposalTargets[proposalId];
        uint[] memory values = proposalValues[proposalId];
        bytes[] memory calldatas = proposalCalldatas[proposalId];
        
        for (uint i = 0; i < targets.length; i++) {
            string memory signature = "";
            if (calldatas[i].length >= 4) {
                signature = string(abi.encodePacked(calldatas[i][0], calldatas[i][1], calldatas[i][2], calldatas[i][3]));
            }
            _queueOrRevertInternal(targets[i], values[i], signature, calldatas[i], eta);
        }
        proposal.eta = eta;
        emit ProposalQueued(proposalId, eta);
    }

    function execute(uint proposalId) external {
        require(admins[msg.sender], "CustomGovernor::execute: only admins can execute");
        require(state(proposalId) == IGovernorBravo.ProposalState.Queued, "CustomGovernor::execute: proposal can only be executed if it is queued");
        Proposal storage proposal = _proposals[proposalId];
        proposal.executed = true;
        address[] memory targets = proposalTargets[proposalId];
        uint[] memory values = proposalValues[proposalId];
        bytes[] memory calldatas = proposalCalldatas[proposalId];
        
        for (uint i = 0; i < targets.length; i++) {
            string memory signature = "";
            if (calldatas[i].length >= 4) {
                signature = string(abi.encodePacked(calldatas[i][0], calldatas[i][1], calldatas[i][2], calldatas[i][3]));
            }
            timelock.executeTransaction{value: values[i]}(targets[i], values[i], signature, calldatas[i], proposal.eta);
        }
        emit ProposalExecuted(proposalId);
    }

    function cancel(uint proposalId) external {
        IGovernorBravo.ProposalState state = state(proposalId);
        require(state != IGovernorBravo.ProposalState.Executed, "CustomGovernor::cancel: cannot cancel executed proposal");

        Proposal storage proposal = _proposals[proposalId];
        require(msg.sender == proposal.proposer, "CustomGovernor::cancel: only proposer can cancel");

        proposal.canceled = true;
        address[] memory targets = proposalTargets[proposalId];
        uint[] memory values = proposalValues[proposalId];
        bytes[] memory calldatas = proposalCalldatas[proposalId];
        
        for (uint i = 0; i < targets.length; i++) {
            string memory signature = "";
            if (calldatas[i].length >= 4) {
                signature = string(abi.encodePacked(calldatas[i][0], calldatas[i][1], calldatas[i][2], calldatas[i][3]));
            }
            timelock.cancelTransaction(targets[i], values[i], signature, calldatas[i], proposal.eta);
        }

        emit ProposalCanceled(proposalId);
    }

    /**
     * @notice Check if an address is an admin
     * @param admin The address to check
     * @return Whether the address is an admin
     */
    function isAdmin(address admin) external view returns (bool) {
        return admins[admin];
    }

    /**
     * @notice Add or remove an admin
     * @param admin The address to add or remove
     * @param isAdmin Whether to add (true) or remove (false) the admin
     */
    function setAdmin(address admin, bool isAdmin) external {
        require(admins[msg.sender], "CustomGovernor::setAdmin: only admins can manage admins");
        admins[admin] = isAdmin;
        emit GovernorAdminChanged(admin, isAdmin);
    }

    /**
     * @notice Get the number of approvals for a proposal
     * @param proposalId The proposal to check
     * @return Number of approvals
     */
    function getProposalApprovals(uint proposalId) external view returns (uint) {
        return proposalApprovalCounts[proposalId];
    }

    /**
     * @notice Check if a proposal has enough approvals to be queued
     * @param proposalId The proposal to check
     * @return Whether the proposal has enough approvals
     */
    function hasEnoughApprovals(uint proposalId) external view returns (bool) {
        return proposalApprovalCounts[proposalId] >= multisigThreshold;
    }

    function castVote(uint proposalId, uint8 support) external returns (uint) {
        // For multisig, castVote acts as approveProposal
        // support parameter is ignored, any call to castVote counts as approval
        require(admins[msg.sender], "CustomGovernor::castVote: only admins can vote");
        require(!proposalApprovals[proposalId][msg.sender], "CustomGovernor::castVote: already voted");
        
        proposalApprovals[proposalId][msg.sender] = true;
        proposalApprovalCounts[proposalId]++;
        emit ProposalApproved(proposalId, msg.sender);
        
        return 1; // Return 1 to indicate successful vote
    }

    function state(uint proposalId) public view returns (IGovernorBravo.ProposalState) {
        require(proposalCount >= proposalId, "CustomGovernor::state: invalid proposal id");
        Proposal storage proposal = _proposals[proposalId];
        if (proposal.canceled) {
            return IGovernorBravo.ProposalState.Canceled;
        }
        if (proposal.executed) {
            return IGovernorBravo.ProposalState.Executed;
        }
        if (proposal.eta == 0) {
            return IGovernorBravo.ProposalState.Succeeded; // Auto-succeed for multisig
        }
        if (block.timestamp >= proposal.eta + timelock.GRACE_PERIOD()) {
            return IGovernorBravo.ProposalState.Expired;
        }
        return IGovernorBravo.ProposalState.Queued;
    }

    function _queueOrRevertInternal(address target, uint value, string memory signature, bytes memory data, uint eta) internal {
        require(!timelock.queuedTransactions(keccak256(abi.encode(target, value, signature, data, eta))), "CustomGovernor::_queueOrRevertInternal: identical proposal action already queued at eta");
        timelock.queueTransaction(target, value, signature, data, eta);
    }

    function proposals(uint256 proposalId) external view returns (Proposal memory) { return _proposals[proposalId]; }
    
    function proposalDetails(uint proposalId) external view returns (address[] memory, uint[] memory, bytes[] memory, bytes32) {
        return (proposalTargets[proposalId], proposalValues[proposalId], proposalCalldatas[proposalId], bytes32(0));
    }

    // Interface compliance functions (minimal implementation)
    function comp() external view returns (address) { return token; }
    function MIN_VOTING_PERIOD() external pure returns (uint256) { return 0; }
    function MIN_VOTING_DELAY() external pure returns (uint256) { return 0; }
    function MIN_PROPOSAL_THRESHOLD() external pure returns (uint256) { return 0; }
    function votingDelay() external pure returns (uint256) { return 0; }
    function votingPeriod() external pure returns (uint256) { return 0; }
    function proposalEta(uint256 proposalId) external view returns (uint256) { return _proposals[proposalId].eta; }

    // UUPS Upgrade functionality
    /**
     * @notice Propose an upgrade to the implementation
     * @param newImplementation The address of the new implementation
     * @param description Description of the upgrade
     */
    function proposeUpgrade(address newImplementation, string memory description) external returns (uint) {
        require(admins[msg.sender], "CustomGovernor::proposeUpgrade: only admins can propose upgrades");
        
        // Create upgrade proposal data
        address[] memory targets = new address[](1);
        targets[0] = address(this);
        
        uint[] memory values = new uint[](1);
        values[0] = 0;
        
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSelector(this.upgradeTo.selector, newImplementation);
        
        // Use the regular propose function
        return propose(targets, values, calldatas, description);
    }

    /**
     * @notice Propose an upgrade with initialization data
     * @param newImplementation The address of the new implementation
     * @param data The initialization data
     * @param description Description of the upgrade
     */
    function proposeUpgradeAndCall(address newImplementation, bytes calldata data, string memory description) external returns (uint) {
        require(admins[msg.sender], "CustomGovernor::proposeUpgradeAndCall: only admins can propose upgrades");
        
        // Create upgrade proposal data
        address[] memory targets = new address[](1);
        targets[0] = address(this);
        
        uint[] memory values = new uint[](1);
        values[0] = 0;
        
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSelector(this.upgradeToAndCall.selector, newImplementation, data);
        
        // Use the regular propose function
        return propose(targets, values, calldatas, description);
    }



    /**
     * @notice Execute upgrade (internal function called by proposal execution)
     * @param newImplementation The address of the new implementation
     */
    function upgradeTo(address newImplementation) external {
        require(msg.sender == address(this), "CustomGovernor::upgradeTo: only self can call");
        _upgradeToAndCallUUPS(newImplementation, bytes(""), false);
    }

    /**
     * @notice Execute upgrade with initialization data (internal function called by proposal execution)
     * @param newImplementation The address of the new implementation
     * @param data The initialization data
     */
    function upgradeToAndCall(address newImplementation, bytes calldata data) external {
        require(msg.sender == address(this), "CustomGovernor::upgradeToAndCall: only self can call");
        _upgradeToAndCallUUPS(newImplementation, data, true);
    }

}