// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "@forge-std/src/Vm.sol";
import "@comet-contracts/bridges/arbitrum/ArbitrumBridgeReceiver.sol";
import "../script/marketupdates/helpers/GovernanceHelper.sol";
import "../script/marketupdates/helpers/MarketUpdateAddresses.sol";
import "../script/marketupdates/helpers/ChainAddresses.sol";
import "../script/marketupdates/helpers/MarketUpdateContractsDeployer.sol";
import "../script/marketupdates/helpers/BridgeHelper.sol";

abstract contract MarketUpdateDeploymentBaseTest {

    IGovernorBravo public governorBravo = IGovernorBravo(MarketUpdateAddresses.GOVERNOR_BRAVO_PROXY_ADDRESS);

    function createMarketUpdateDeployment(Vm vm) public returns (MarketUpdateContractsDeployer.DeployedContracts memory) {
        bytes32 salt = keccak256(abi.encodePacked("Salt-31"));
        
        MarketUpdateContractsDeployer.DeployedContracts memory deployedContracts = MarketUpdateContractsDeployer.deployContracts(
            salt,
            MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS,
            MarketUpdateAddresses.MARKET_ADMIN_PAUSE_GUARDIAN_ADDRESS,
            MarketUpdateAddresses.MARKET_UPDATE_PROPOSAL_GUARDIAN_ADDRESS,
            MarketUpdateAddresses.GOVERNOR_BRAVO_TIMELOCK_ADDRESS
        );


        console.log("MarketUpdateTimelock: ", deployedContracts.marketUpdateTimelock);
        console.log("MarketUpdateProposer: ", deployedContracts.marketUpdateProposer);
        console.log("NewConfiguratorImplementation: ", deployedContracts.newConfiguratorImplementation);
        console.log("NewCometProxyAdmin: ", deployedContracts.newCometProxyAdmin);
        console.log("MarketAdminPermissionChecker: ", deployedContracts.marketAdminPermissionChecker);


        address proposalCreator = GovernanceHelper.getTopDelegates()[0];

        MarketUpdateAddresses.MarketUpdateAddressesStruct memory addresses = MarketUpdateAddresses.getAddressesForChain(
            ChainAddresses.Chain.ETHEREUM,
            deployedContracts,
            MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS
        );

        uint256 proposalId = GovernanceHelper.createDeploymentProposal(vm, addresses, proposalCreator);

        GovernanceHelper.moveProposalToActive(vm, proposalId);

        GovernanceHelper.voteOnProposal(vm, proposalId, proposalCreator);

        GovernanceHelper.moveProposalToSucceed(vm, proposalId);

        governorBravo.queue(proposalId);

        GovernanceHelper.moveProposalToExecution(vm, proposalId);

        console.log("proposal state after execution: ", uint(governorBravo.state(proposalId)));

        return deployedContracts;
    }

    function createMarketUpdateDeploymentForL2(Vm vm, ChainAddresses.Chain chain) public returns (MarketUpdateContractsDeployer.DeployedContracts memory) {
        bytes32 salt = keccak256(abi.encodePacked("Salt-31"));

        address localTimelock = ChainAddresses.getLocalTimelockAddress(chain);

        MarketUpdateContractsDeployer.DeployedContracts memory deployedContracts = MarketUpdateContractsDeployer.deployContracts(
            salt,
            MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS,
            MarketUpdateAddresses.MARKET_ADMIN_PAUSE_GUARDIAN_ADDRESS,
            MarketUpdateAddresses.MARKET_UPDATE_PROPOSAL_GUARDIAN_ADDRESS,
            localTimelock
        );


        console.log("MarketUpdateTimelock: ", deployedContracts.marketUpdateTimelock);
        console.log("MarketUpdateProposer: ", deployedContracts.marketUpdateProposer);
        console.log("NewConfiguratorImplementation: ", deployedContracts.newConfiguratorImplementation);
        console.log("NewCometProxyAdmin: ", deployedContracts.newCometProxyAdmin);
        console.log("MarketAdminPermissionChecker: ", deployedContracts.marketAdminPermissionChecker);


        MarketUpdateAddresses.MarketUpdateAddressesStruct memory addresses = MarketUpdateAddresses.getAddressesForChain(
            chain,
            deployedContracts,
            MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS
        );

        GovernanceHelper.ProposalRequest memory proposalRequest = GovernanceHelper.createDeploymentProposalRequest(addresses);

        BridgeHelper.simulateMessageAndExecuteProposal(vm, chain, MarketUpdateAddresses.GOVERNOR_BRAVO_TIMELOCK_ADDRESS, proposalRequest);

        return deployedContracts;
    }

    function updateAndVerifySupplyKink(
        Vm vm,
        address cometProxy, 
        address configuratorProxy, 
        address cometProxyAdminNew, 
        string memory marketName
        ) public {
            
        uint256 oldSupplyKinkBeforeGovernorUpdate = Comet(payable(cometProxy)).supplyKink();
        uint256 newSupplyKinkByGovernorTimelock = 300000000000000000;
        
        assert(oldSupplyKinkBeforeGovernorUpdate != newSupplyKinkByGovernorTimelock);

        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        string[] memory signatures = new string[](2);
        bytes[] memory calldatas = new bytes[](2);
        string memory description = string(abi.encodePacked("Proposal to update Supply Kink for ", marketName, " Market by Governor Timelock"));

        targets[0] = configuratorProxy;
        signatures[0] = "setSupplyKink(address,uint64)";
        calldatas[0] = abi.encode(cometProxy, newSupplyKinkByGovernorTimelock);

        targets[1] = cometProxyAdminNew;
        signatures[1] = "deployAndUpgradeTo(address,address)";
        calldatas[1] = abi.encode(configuratorProxy, cometProxy);

        GovernanceHelper.ProposalRequest memory proposalRequest = GovernanceHelper.ProposalRequest({
            targets: targets,
            values: values,
            signatures: signatures,
            calldatas: calldatas
        });

        GovernanceHelper.createProposalAndPass(vm, proposalRequest, description);

        // check the new kink value
        uint256 newSupplyKinkAfterGovernorUpdate = Comet(payable(cometProxy)).supplyKink();
        assert(newSupplyKinkAfterGovernorUpdate == newSupplyKinkByGovernorTimelock);

        // Setting new Supply Kink using Market Admin
        uint256 oldSupplyKinkBeforeMarketAdminUpdate = Comet(payable(cometProxy)).supplyKink();
        uint256 newSupplyKinkByMarketAdmin = 400000000000000000;

        assert(oldSupplyKinkBeforeMarketAdminUpdate != newSupplyKinkByMarketAdmin);

        calldatas[0] = abi.encode(cometProxy, newSupplyKinkByMarketAdmin);

        description = string(abi.encodePacked("Proposal to update Supply Kink for ", marketName, " Market by Market Admin"));
        GovernanceHelper.createAndPassMarketUpdateProposal(vm, proposalRequest, description);

        uint256 newSupplyKinkAfterMarketAdminUpdate = Comet(payable(cometProxy)).supplyKink();
        assert(newSupplyKinkAfterMarketAdminUpdate == newSupplyKinkByMarketAdmin);
    }

    function updateAndVerifySupplyKinkInL2(
        Vm vm,
        ChainAddresses.Chain chain,
        address cometProxy,
        address configuratorProxy,
        address cometProxyAdminNew,
        address marketUpdateProposer,
        string memory marketName
        ) public {

        uint256 oldSupplyKinkBeforeGovernorUpdate = Comet(payable(cometProxy)).supplyKink();
        uint256 newSupplyKinkByGovernorTimelock = 300000000000000000;

        assert(oldSupplyKinkBeforeGovernorUpdate != newSupplyKinkByGovernorTimelock);

        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        string[] memory signatures = new string[](2);
        bytes[] memory calldatas = new bytes[](2);
        string memory description = string(abi.encodePacked("Proposal to update Supply Kink for ", marketName, " Market by Governor Timelock"));

        targets[0] = configuratorProxy;
        signatures[0] = "setSupplyKink(address,uint64)";
        calldatas[0] = abi.encode(cometProxy, newSupplyKinkByGovernorTimelock);

        targets[1] = cometProxyAdminNew;
        signatures[1] = "deployAndUpgradeTo(address,address)";
        calldatas[1] = abi.encode(configuratorProxy, cometProxy);

        GovernanceHelper.ProposalRequest memory proposalRequest = GovernanceHelper.ProposalRequest({
            targets: targets,
            values: values,
            signatures: signatures,
            calldatas: calldatas
        });

        BridgeHelper.simulateMessageAndExecuteProposal(vm, chain, MarketUpdateAddresses.GOVERNOR_BRAVO_TIMELOCK_ADDRESS, proposalRequest);

        // check the new kink value
        uint256 newSupplyKinkAfterGovernorUpdate = Comet(payable(cometProxy)).supplyKink();
        assert(newSupplyKinkAfterGovernorUpdate == newSupplyKinkByGovernorTimelock);

        // Setting new Supply Kink using Market Admin
        uint256 oldSupplyKinkBeforeMarketAdminUpdate = Comet(payable(cometProxy)).supplyKink();
        uint256 newSupplyKinkByMarketAdmin = 400000000000000000;

        assert(oldSupplyKinkBeforeMarketAdminUpdate != newSupplyKinkByMarketAdmin);

        calldatas[0] = abi.encode(cometProxy, newSupplyKinkByMarketAdmin);

        description = string(abi.encodePacked("Proposal to update Supply Kink for ", marketName, " Market by Market Admin"));
        GovernanceHelper.createAndPassMarketUpdateProposalL2(vm, proposalRequest, description, marketUpdateProposer);

        uint256 newSupplyKinkAfterMarketAdminUpdate = Comet(payable(cometProxy)).supplyKink();
        assert(newSupplyKinkAfterMarketAdminUpdate == newSupplyKinkByMarketAdmin);
    }
}
