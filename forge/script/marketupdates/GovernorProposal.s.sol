// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../lib/forge-std/src/Script.sol";
import "../../lib/forge-std/src/console.sol";

import "../../../contracts/IGovernorBravo.sol";
import "../../../contracts/IComp.sol";
import "../../../contracts/CometProxyAdmin.sol";

import "./helpers/GovernanceHelper.sol";
import "./helpers/MarketUpdateAddresses.sol";

contract GovernorProposal is Script {

    function run() external {
        string memory chainName = vm.envString("CHAIN_NAME"); // Access the env variable

        // Define the address of the Governor Bravo Proxy
        address governorBravoProxyAddress = 0x309a862bbC1A00e45506cB8A802D1ff10004c8C0;

        // Cast the proxy address to the GovernorBravoDelegate interface
        IGovernorBravo governorBravo = IGovernorBravo(governorBravoProxyAddress);


        MarketUpdateAddresses.MarketUpdateAddressesStruct memory addresses = MarketUpdateAddresses.getAddressesForChain(MarketUpdateAddresses.getChainFromString(chainName));
        uint256 proposalId = GovernanceHelper.createDeploymentProposal(vm, addresses, addresses);

        GovernanceHelper.moveProposalToActive(vm, proposalId);

        GovernanceHelper.voteOnProposal(vm, proposalId);

        GovernanceHelper.moveProposalToSucceed(vm, proposalId);

        governorBravo.queue(proposalId);

        GovernanceHelper.moveProposalToExecution(vm, proposalId);
       
        governorBravo.execute(proposalId);

        console.log("proposal state after execution: ", uint(governorBravo.state(proposalId)));
    }
}
