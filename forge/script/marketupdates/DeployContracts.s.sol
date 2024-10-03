// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@forge-std/src/Script.sol";
import "@forge-std/src/console.sol";
import "@comet-contracts/marketupdates/MarketUpdateTimelock.sol";
import "@comet-contracts/marketupdates/MarketUpdateProposer.sol";
import "@comet-contracts/Configurator.sol";
import "@comet-contracts/CometProxyAdmin.sol";
import "@comet-contracts/marketupdates/MarketAdminPermissionChecker.sol";
import "@comet-contracts/Create2DeployerInterface.sol";
import "./helpers/MarketUpdateAddresses.sol";
import "./helpers/MarketUpdateContractsDeployer.sol";

contract DeployContracts is Script {
    address public deployedWalletAddress;

    struct ContractDeploymentParams {
        bytes creationCode;
        bytes constructorArgs;
        bytes expectedRuntimeCode;
        string contractName;
    }

    function run() external {
        address timelock = 0x6d903f6003cca6255D85CcA4D3B5E5146dC33925;

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        
        bytes32 salt = keccak256(abi.encodePacked("Salt-31")); 

        /// Call library function
        MarketUpdateContractsDeployer.DeployedContracts memory deployedContracts = MarketUpdateContractsDeployer.deployContracts(
            salt,
            MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS,
            MarketUpdateAddresses.MARKET_ADMIN_PAUSE_GUARDIAN_ADDRESS,
            MarketUpdateAddresses.MARKET_UPDATE_PROPOSAL_GUARDIAN_ADDRESS,
            timelock
        );

        /// Console log deployed contracts
        console.log("MarketUpdateTimelock: ", deployedContracts.marketUpdateTimelock);
        console.log("MarketUpdateProposer: ", deployedContracts.marketUpdateProposer);
        console.log("NewConfiguratorImplementation: ", deployedContracts.newConfiguratorImplementation);
        console.log("NewCometProxyAdmin: ", deployedContracts.newCometProxyAdmin);
        console.log("MarketAdminPermissionChecker: ", deployedContracts.marketAdminPermissionChecker);

        vm.stopBroadcast();
    }
}
