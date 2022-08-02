// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @dev Interface for interacting with Governor bravo.
 * Note Not a comprehensive interface
 */
interface IGovernorBravo {
    enum ProposalState {
        Pending,
        Active,
        Canceled,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }

    event ProposalCreated(
        uint256 proposalId,
        address proposer,
        address[] targets,
        uint256[] values,
        string[] signatures,
        bytes[] calldatas,
        uint256 startBlock,
        uint256 endBlock,
        string description
    );

    event ProposalCanceled(uint256 proposalId);

    event ProposalQueued(uint256 proposalId, uint256 eta);

    event ProposalExecuted(uint256 proposalId);

    function state(uint256 proposalId) external view returns (ProposalState);

    function propose(
        address[] memory targets,
        uint256[] memory values,
        string[] memory signatures,
        bytes[] memory calldatas,
        string memory description
    ) external returns (uint256 proposalId);

    function queue(uint256 proposalId) external payable;

    function execute(uint256 proposalId) external payable;

    function castVote(uint256 proposalId, uint8 support) external returns (uint256 balance);
}