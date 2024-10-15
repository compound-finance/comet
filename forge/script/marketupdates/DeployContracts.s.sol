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
import "./helpers/ChainAddresses.sol";

contract DeployContracts is Script {
    address public deployedWalletAddress;

    address constant public create2DeployerAddress = 0x13b0D85CcB8bf860b6b79AF3029fCA081AE9beF2;
    address constant public ZER0_ADDRESS_MARKET_UPDATE_PROPOSAL_GUARDIAN = address(0);
    address constant public ZER0_ADDRESS_MARKET_ADMIN_PAUSE_GUARDIAN = address(0);
    address constant public INITIAL_ADDRESS_MARKET_UPDATE_MULTI_SIG = address(0x7e14050080306cd36b47DE61ce604b3a1EC70c4e);


    function run() external {
        uint256 passedChainId = vm.envUint("CHAIN_ID");

        require(block.chainid == passedChainId, "Chain ID mismatch");

        ChainAddresses.Chain chain = ChainAddresses.getChainBasedOnChainId(passedChainId);
        ChainAddresses.ChainAddressesStruct memory chainAddresses = ChainAddresses.getChainAddresses(chain);

        console.log("Deploying contracts with sender: ", msg.sender);

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address deployer = vm.rememberKey(deployerPrivateKey);
        vm.startBroadcast(deployer);

        console.log("Broadcasting transaction with deployer: ", deployer);

        bytes32 salt = keccak256(abi.encodePacked(vm.envString("SALT")));

        /// Call library function
        MarketUpdateContractsDeployer.DeployedContracts memory deployedContracts = MarketUpdateContractsDeployer._deployContracts(
            salt,
            msg.sender,
            chainAddresses.marketAdmin,
            chainAddresses.marketUpdatePauseGuardian,
            chainAddresses.marketUpdateProposalGuardian,
            chainAddresses.governorTimelockAddress
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
