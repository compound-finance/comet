// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../ITimelock.sol";

contract BaseBridgeReceiver {
    /** Custom errors **/
    error AlreadyInitialized();
    error BadData();
    error InvalidProposalId();
    error ProposalNotQueued();
    error TransactionAlreadyQueued();
    error Unauthorized();

    /** Events **/
    event Initialized(address indexed govTimelock, address indexed localTimelock);
    event NewLocalTimelock(address indexed oldLocalTimelock, address indexed newLocalTimelock);
    event NewGovTimelock(address indexed oldGovTimelock, address indexed newGovTimelock);
    event ProposalCreated(address indexed messageSender, uint id, address[] targets, uint[] values, string[] signatures, bytes[] calldatas, uint eta);
    event ProposalExecuted(uint id);

    /** Public variables **/

    /// @notice Address of the governing contract that this bridge receiver expects to
    ///  receive messages from; likely an address from another chain (e.g. mainnet)
    address public govTimelock;

    /// @notice Address of the timelock on this chain that the bridge receiver
    /// will send messages to
    address public localTimelock;

    /// @notice Whether contract has been initialized
    bool public initialized;

    /// @notice Total count of proposals generated
    uint public proposalCount;

    struct Proposal {
        uint id;
        address[] targets;
        uint[] values;
        string[] signatures;
        bytes[] calldatas;
        uint eta;
        bool executed;
    }

    /// @notice Mapping of proposal ids to their full proposal data
    mapping (uint => Proposal) public proposals;

    enum ProposalState {
        Queued,
        Expired,
        Executed
    }

    /**
     * @notice Initialize the contract
     * @param _govTimelock Address of the governing contract that this contract
     * will receive messages from (likely on another chain)
     * @param _localTimelock Address of the timelock contract that this contract
     * will send messages to
     */
    function initialize(address _govTimelock, address _localTimelock) external {
        if (initialized) revert AlreadyInitialized();
        govTimelock = _govTimelock;
        localTimelock = _localTimelock;
        initialized = true;
        emit Initialized(_govTimelock, _localTimelock);
    }

    /**
     * @notice Accept admin role for the localTimelock
     */
    function acceptLocalTimelockAdmin() external {
        if (msg.sender != localTimelock) revert Unauthorized();
        ITimelock(localTimelock).acceptAdmin();
    }

    /**
     * @notice Set localTimelock address
     * @param newTimelock Address to set as the localTimelock
     */
    function setLocalTimelock(address newTimelock) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldLocalTimelock = localTimelock;
        localTimelock = newTimelock;
        emit NewLocalTimelock(oldLocalTimelock, newTimelock);
    }

    /**
     * @notice Set govTimelock address
     * @param newTimelock Address to set as the govTimelock
     */
    function setGovTimelock(address newTimelock) public {
        if (msg.sender != localTimelock) revert Unauthorized();
        address oldGovTimelock = govTimelock;
        govTimelock = newTimelock;
        emit NewGovTimelock(oldGovTimelock, newTimelock);
    }

    /**
     * @notice Process a message sent from the governing timelock (across a bridge)
     * @param messageSender Address of the contract that sent the bridged message
     * @param data ABI-encoded bytes containing the transactions to be queued on the local timelock
     */
    function processMessage(
        address messageSender,
        bytes calldata data
    ) internal {
        if (messageSender != govTimelock) revert Unauthorized();

        address[] memory targets;
        uint256[] memory values;
        string[] memory signatures;
        bytes[] memory calldatas;

        (targets, values, signatures, calldatas) = abi.decode(
            data,
            (address[], uint256[], string[], bytes[])
        );

        if (values.length != targets.length) revert BadData();
        if (signatures.length != targets.length) revert BadData();
        if (calldatas.length != targets.length) revert BadData();

        uint delay = ITimelock(localTimelock).delay();
        uint eta = block.timestamp + delay;

        for (uint8 i = 0; i < targets.length; ) {
            if (ITimelock(localTimelock).queuedTransactions(keccak256(abi.encode(targets[i], values[i], signatures[i], calldatas[i], eta)))) revert TransactionAlreadyQueued();
            ITimelock(localTimelock).queueTransaction(targets[i], values[i], signatures[i], calldatas[i], eta);
            unchecked { i++; }
        }

        proposalCount++;
        Proposal memory proposal = Proposal({
            id: proposalCount,
            targets: targets,
            values: values,
            signatures: signatures,
            calldatas: calldatas,
            eta: eta,
            executed: false
        });

        proposals[proposal.id] = proposal;
        emit ProposalCreated(messageSender, proposal.id, targets, values, signatures, calldatas, eta);
    }

    /**
     * @notice Execute a queued proposal
     * @param proposalId The id of the proposal to execute
     */
    function executeProposal(uint proposalId) external {
        if (state(proposalId) != ProposalState.Queued) revert ProposalNotQueued();
        Proposal storage proposal = proposals[proposalId];
        proposal.executed = true;
        for (uint i = 0; i < proposal.targets.length; i++) {
            ITimelock(localTimelock).executeTransaction(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i], proposal.eta);
        }
        emit ProposalExecuted(proposalId);
    }

    /**
     * @notice Get the state of a proposal
     * @param proposalId Id of the proposal
     * @return The state of the given proposal (queued, expired or executed)
     */
    function state(uint proposalId) public view returns (ProposalState) {
        if (proposalId > proposalCount || proposalId == 0) revert InvalidProposalId();
        Proposal memory proposal = proposals[proposalId];
        if (proposal.executed) {
            return ProposalState.Executed;
        } else if (block.timestamp >= (proposal.eta + ITimelock(localTimelock).GRACE_PERIOD())) {
            return ProposalState.Expired;
        } else {
            return ProposalState.Queued;
        }
    }
}