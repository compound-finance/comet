// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@forge-std/src/Vm.sol";
import "@forge-std/src/console.sol";
import "@comet-contracts/IGovernorBravo.sol";
import "@comet-contracts/IComp.sol";
import "@comet-contracts/marketupdates/MarketUpdateProposer.sol";

import "./MarketUpdateAddresses.sol";


library GovernanceHelper {
    uint constant public BLOCKS_PER_DAY = 7168;

    address constant governorBravoProxyAddress = 0xc0Da02939E1441F497fd74F78cE7Decb17B66529;
    IGovernorBravo constant governorBravo = IGovernorBravo(governorBravoProxyAddress);

    // COMP token address
    address constant compTokenAddress = 0xc00e94Cb662C3520282E6f5717214004A7f26888;
    IComp constant compToken = IComp(compTokenAddress);

    struct ProposalRequest {
        address[] targets;
        uint256[] values;
        string[] signatures;
        bytes[] calldatas;
    }

    function createDeploymentProposalRequest(MarketUpdateAddresses.MarketUpdateAddressesStruct memory addresses) public pure returns (ProposalRequest memory) {
        address cometProxyAdminOldAddress = addresses.cometProxyAdminAddress;
        address configuratorProxyAddress = addresses.configuratorProxyAddress;
        address configuratorNewAddress = addresses.configuratorImplementationAddress;
        address cometProxyAdminNewAddress = addresses.newCometProxyAdminAddress;
        address marketAdminPermissionCheckerAddress = addresses.marketAdminPermissionCheckerAddress;
        address marketUpdateTimelockAddress = addresses.marketUpdateTimelockAddress;
        address marketUpdateProposerAddress = addresses.marketAdminProposerAddress;

        // Dynamically allocate arrays based on the number of markets
        uint256 numMarkets = addresses.markets.length;
        uint256 totalTargets = 6 + numMarkets; // 6 fixed operations + numMarkets
        address[] memory targets = new address[](totalTargets);
        uint256[] memory values = new uint256[](totalTargets);
        string[] memory signatures = new string[](totalTargets);
        bytes[] memory calldatas = new bytes[](totalTargets);

        // First, handle market-specific operations
        for (uint256 i = 0; i < numMarkets; i++) {
            address cometProxyAddress = addresses.markets[i].cometProxyAddress;

            // Change Proxy Admin for each market
            targets[i] = cometProxyAdminOldAddress;
            signatures[i] = "changeProxyAdmin(address,address)";
            calldatas[i] = abi.encode(cometProxyAddress, cometProxyAdminNewAddress);
        }

        // Now handle the fixed operations (5)
        uint256 offset = numMarkets;

        // Change Proxy Admin for configurator proxy
        targets[offset] = cometProxyAdminOldAddress;
        signatures[offset] = "changeProxyAdmin(address,address)";
        calldatas[offset] = abi.encode(configuratorProxyAddress, cometProxyAdminNewAddress);

        // Upgrade configurator proxy
        targets[offset + 1] = cometProxyAdminNewAddress;
        signatures[offset + 1] = "upgrade(address,address)";
        calldatas[offset + 1] = abi.encode(configuratorProxyAddress, configuratorNewAddress);

        // Set Market Admin
        targets[offset + 2] = marketAdminPermissionCheckerAddress;
        signatures[offset + 2] = "setMarketAdmin(address)";
        calldatas[offset + 2] = abi.encode(marketUpdateTimelockAddress);

        // Set Market Admin Permission Checker on the configurator
        targets[offset + 3] = configuratorProxyAddress;
        signatures[offset + 3] = "setMarketAdminPermissionChecker(address)";
        calldatas[offset + 3] = abi.encode(marketAdminPermissionCheckerAddress);

        // Set Market Admin Permission Checker on the new comet proxy admin
        targets[offset + 4] = cometProxyAdminNewAddress;
        signatures[offset + 4] = "setMarketAdminPermissionChecker(address)";
        calldatas[offset + 4] = abi.encode(marketAdminPermissionCheckerAddress);

        // Set Market Update Proposer
        targets[offset + 5] = marketUpdateTimelockAddress;
        signatures[offset + 5] = "setMarketUpdateProposer(address)";
        calldatas[offset + 5] = abi.encode(marketUpdateProposerAddress);

        return ProposalRequest(targets, values, signatures, calldatas);
    }

    function createDeploymentProposal(Vm vm, MarketUpdateAddresses.MarketUpdateAddressesStruct memory addresses, address proposalCreator) public returns (uint256) {
        IGovernorBravo governorBravo = IGovernorBravo(MarketUpdateAddresses.GOVERNOR_BRAVO_PROXY_ADDRESS);
        ProposalRequest memory proposalRequest = createDeploymentProposalRequest(addresses);
        string memory description = "Proposal to trigger updates for market admin";
        vm.startBroadcast(proposalCreator);
        uint256 proposalId = governorBravo.propose(proposalRequest.targets, proposalRequest.values, proposalRequest.signatures, proposalRequest.calldatas, description);
        vm.stopBroadcast();
        return proposalId;
    }

    function createProposalAndPass(Vm vm, ProposalRequest memory proposalRequest, string memory description) public {
        // Create a proposal
        address proposalCreator = getTopDelegates()[0];
        vm.startBroadcast(proposalCreator);
        uint256 proposalId = governorBravo.propose(proposalRequest.targets, proposalRequest.values, proposalRequest.signatures, proposalRequest.calldatas, description);
        vm.stopBroadcast();

        // Move proposal to Active state
        moveProposalToActive(vm, proposalId);

        // Vote on the proposal
        voteOnProposal(vm, proposalId, proposalCreator);

        // Move proposal to Succeeded state
        moveProposalToSucceed(vm, proposalId);

        // Queue the proposal
        governorBravo.queue(proposalId);

        // Move proposal to Execution state
        moveProposalToExecution(vm, proposalId);
    }

    function createAndPassMarketUpdateProposal(Vm vm, ProposalRequest memory proposalRequest, string memory description, address marketUpdateProposer) public {
        vm.startPrank(MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS);
        MarketUpdateProposer(marketUpdateProposer).propose(proposalRequest.targets, proposalRequest.values, proposalRequest.signatures, proposalRequest.calldatas, description);

        // Fast forward by 5 days
        vm.warp(block.timestamp + 5 days);

        MarketUpdateProposer(marketUpdateProposer).execute(1);

        vm.stopPrank();
    }

    function createAndPassMarketUpdateProposalL2(Vm vm, ProposalRequest memory proposalRequest, string memory description, address marketUpdateProposer) public {
        vm.startPrank(MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS);
        MarketUpdateProposer(marketUpdateProposer).propose(proposalRequest.targets, proposalRequest.values, proposalRequest.signatures, proposalRequest.calldatas, description);

        // Fast forward by 5 days
        vm.warp(block.timestamp + 5 days);

        MarketUpdateProposer(marketUpdateProposer).execute(1);

        vm.stopPrank();
    }

    function moveProposalToActive(Vm vm, uint proposalId) public {
        require(governorBravo.state(proposalId) == IGovernorBravo.ProposalState.Pending, "Proposal is not Pending");
        require(governorBravo.proposals(proposalId).eta == 0, "Proposal has already been queued");

        // Add a check to see the current state is pending
        uint votingDelay = governorBravo.votingDelay();

        vm.roll(block.number + votingDelay + 7146);

        require(governorBravo.state(proposalId) == IGovernorBravo.ProposalState.Active, "Proposal is not Active");


    }

    function moveProposalToSucceed(Vm vm, uint proposalId) public {
        require(governorBravo.state(proposalId) == IGovernorBravo.ProposalState.Active, "Proposal is not Active");


        require(governorBravo.proposals(proposalId).forVotes > governorBravo.quorumVotes(), "Proposal does not have enough votes");
        // Advance to the end of the voting period
        uint256 endBlock = governorBravo.proposals(proposalId).endBlock;
        vm.roll(endBlock + 1);

        require(governorBravo.state(proposalId) == IGovernorBravo.ProposalState.Succeeded, "Proposal is not Succeeded");
    }

    function moveProposalToExecution(Vm vm, uint proposalId) public {
        uint proposalEta = governorBravo.proposals(proposalId).eta;
        require(proposalEta != 0, "Proposal has not been queued");

        vm.warp(proposalEta + 2 days);

        require(block.timestamp >= proposalEta, "Time has not passed for proposal to be executed");
        governorBravo.execute(proposalId);
        require(governorBravo.state(proposalId) == IGovernorBravo.ProposalState.Executed, "Proposal is not Executed");

    }

    function voteOnProposal(Vm vm, uint256 proposalId, address proposalCreator) public {
        address[12] memory voters = getTopDelegates();

        // Cast votes from multiple accounts
        for (uint i = 0; i < voters.length; i++) {
            if (voters[i] == proposalCreator) continue; // Skip zero address
            console.log("Voting with account: ", voters[i]);
            vm.startBroadcast(voters[i]);
            console.log("Proposal state during voting: ", uint(governorBravo.state(proposalId)));
            governorBravo.castVoteWithReason(proposalId, 1, "yes"); // 1 = "For" vote
            vm.stopBroadcast();
            console.log("Done voting with account: ", voters[i]);
        }
    }

    function getTopDelegates() public pure returns (address[12] memory) {
        return [
            0x0579A616689f7ed748dC07692A3F150D44b0CA09,
            0x9AA835Bc7b8cE13B9B0C9764A52FbF71AC62cCF1,
            0x7E959eAB54932f5cFd10239160a7fd6474171318,
            0x2210dc066aacB03C9676C4F1b36084Af14cCd02E,
            0x88F659b4B6D5614B991c6404b34f821e10390eC0,
            0x070341aA5Ed571f0FB2c4a5641409B1A46b4961b,
            0xdC1F98682F4F8a5c6d54F345F448437b83f5E432,
            0xB933AEe47C438f22DE0747D57fc239FE37878Dd1,
            0x2817Cb83c96a091E833A9A93E02D5464034e24f1,
            0x21b3B193B71680E2fAfe40768C03a0Fd305EFa75,
            0xE364E90d0A5289bF462A5c9f6e1CcAE680215413,
            0x3FB19771947072629C8EEE7995a2eF23B72d4C8A
            ];
    }
}
