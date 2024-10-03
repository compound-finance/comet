// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@forge-std/src/Script.sol";
import "@forge-std/src/console.sol";

import "@comet-contracts/IGovernorBravo.sol";
import "@comet-contracts/IComp.sol";
import "@comet-contracts/marketupdates/CometProxyAdminOld.sol";

import "./helpers/DeployedAddresses.sol";
import "./helpers/GovernanceHelper.sol";
import "./helpers/MarketUpdateAddresses.sol";

contract GovernorProposal is Script, DeployedAddresses {

    function run() external {
        string memory chainName = vm.envString("CHAIN_NAME"); // Access the env variable

        // Define the address of the Governor Bravo Proxy
        address governorBravoProxyAddress = 0xc0Da02939E1441F497fd74F78cE7Decb17B66529;

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
