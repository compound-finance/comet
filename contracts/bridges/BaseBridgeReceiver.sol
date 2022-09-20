// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../ITimelock.sol";

contract BaseBridgeReceiver {
    error AlreadyInitialized();
    error BadData();
    error InvalidProposalId();
    error ProposalNotQueued();
    error Unauthorized();

    event Initialized(address indexed l2Timelock, address indexed mainnetTimelock);
    event NewL2Timelock(address indexed oldL2Timelock, address indexed newL2Timelock);
    event NewMainnetTimelock(address indexed oldMainnetTimelock, address indexed newMainnetTimelock);
    event ProposalCreated(address indexed messageSender, uint id, address[] targets, uint[] values, string[] signatures, bytes[] calldatas, uint eta);
    event ProposalExecuted(uint id);

    address public initializer;
    address public mainnetTimelock;
    address public l2Timelock;

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

    mapping (uint => Proposal) public proposals;

    enum ProposalState {
        Queued,
        Expired,
        Executed
    }

    constructor(address _initializer) {
        initializer = _initializer;
    }

    function initialize(address _mainnetTimelock, address _l2Timelock) external {
        if (initializer == address(0)) revert AlreadyInitialized();
        if (msg.sender != initializer) revert Unauthorized();
        mainnetTimelock = _mainnetTimelock;
        l2Timelock = _l2Timelock;
        initializer = address(0);
        emit Initialized(_mainnetTimelock, _l2Timelock);
    }

    function acceptL2TimelockAdmin() external {
        if (msg.sender != l2Timelock) revert Unauthorized();
        ITimelock(l2Timelock).acceptAdmin();
    }

    function setL2Timelock(address newTimelock) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        address oldL2Timelock = l2Timelock;
        l2Timelock = newTimelock;
        emit NewL2Timelock(oldL2Timelock, newTimelock);
    }

    function setMainnetTimelock(address newTimelock) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        address oldMainnetTimelock = mainnetTimelock;
        mainnetTimelock = newTimelock;
        emit NewMainnetTimelock(oldMainnetTimelock, newTimelock);
    }

    function processMessage(
        address messageSender,
        bytes calldata data
    ) internal {
        if (messageSender != mainnetTimelock) revert Unauthorized();

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

        uint delay = ITimelock(l2Timelock).delay();
        uint eta = block.timestamp + delay;

        for (uint8 i = 0; i < targets.length; ) {
            ITimelock(l2Timelock).queueTransaction(targets[i], values[i], signatures[i], calldatas[i], eta);
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

    function executeProposal(uint proposalId) external {
        if (state(proposalId) != ProposalState.Queued) revert ProposalNotQueued();
        Proposal storage proposal = proposals[proposalId];
        proposal.executed = true;
        for (uint i = 0; i < proposal.targets.length; i++) {
            ITimelock(l2Timelock).executeTransaction(proposal.targets[i], proposal.values[i], proposal.signatures[i], proposal.calldatas[i], proposal.eta);
        }
        emit ProposalExecuted(proposalId);
    }

    function state(uint proposalId) public view returns (ProposalState) {
        if (proposalId > proposalCount || proposalId == 0) revert InvalidProposalId();
        Proposal storage proposal = proposals[proposalId];
        if (proposal.executed) {
            return ProposalState.Executed;
        } else if (block.timestamp >= (proposal.eta + ITimelock(l2Timelock).GRACE_PERIOD())) {
            return ProposalState.Expired;
        } else {
            return ProposalState.Queued;
        }
    }
}