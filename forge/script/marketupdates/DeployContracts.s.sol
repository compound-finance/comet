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
import "./helpers/ChainAddresses.sol";

contract DeployContracts is Script {
    address public deployedWalletAddress;

    address constant public create2DeployerAddress = 0x13b0D85CcB8bf860b6b79AF3029fCA081AE9beF2;

    struct DeployedContracts {
        address marketUpdateTimelock;
        address marketUpdateProposer;
        address newCometProxyAdmin;
        address newConfiguratorImplementation;
        address marketAdminPermissionChecker;
    }

    struct ContractDeploymentParams {
        bytes creationCode;
        bytes constructorArgs;
        bytes expectedRuntimeCode;
        string contractName;
    }

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

        bytes32 salt = keccak256(abi.encodePacked("Salt-34"));

        /// Call library function
        DeployedContracts memory deployedContracts = deployContracts(
            salt,
            MarketUpdateAddresses.MARKET_UPDATE_MULTISIG_ADDRESS,
            MarketUpdateAddresses.MARKET_ADMIN_PAUSE_GUARDIAN_ADDRESS,
            MarketUpdateAddresses.MARKET_UPDATE_PROPOSAL_GUARDIAN_ADDRESS,
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

    function deployContracts(
        bytes32 salt,
        address marketUpdateMultiSig, // TODO: Check this is properly used
        address marketAdminPauseGuardianAddress, // TODO: Check this is properly used
        address marketUpdateProposalGuardianAddress, // TODO: Check this is properly used
        address localTimelockAddress
    ) public returns (DeployedContracts memory) {

        ICreate2Deployer create2Deployer = ICreate2Deployer(create2DeployerAddress);

        // Prepare deployment parameters for each contract
        ContractDeploymentParams memory marketUpdateTimelockParams = ContractDeploymentParams({
            creationCode: type(MarketUpdateTimelock).creationCode,
            constructorArgs: abi.encode(msg.sender, 360000), // TODO: add comment on how 360000 is calculated
            expectedRuntimeCode: type(MarketUpdateTimelock).runtimeCode,
            contractName: "MarketUpdateTimelock"
        });

        address computedMarketUpdateTimelockAddress = deployContractWithCreate2(create2Deployer, salt, marketUpdateTimelockParams);

        console.log("Current Governor of timelock", MarketUpdateTimelock(payable(computedMarketUpdateTimelockAddress)).governor());

        ContractDeploymentParams memory marketUpdateProposerParams = ContractDeploymentParams({
            creationCode: type(MarketUpdateProposer).creationCode,
            constructorArgs: abi.encode(
                msg.sender,
                marketUpdateMultiSig,
                marketUpdateProposalGuardianAddress,
                computedMarketUpdateTimelockAddress
            ),
            expectedRuntimeCode: type(MarketUpdateProposer).runtimeCode,
            contractName: "MarketUpdateProposer"
        });

        address computedMarketUpdateProposerAddress = deployContractWithCreate2(create2Deployer, salt, marketUpdateProposerParams);
        MarketUpdateProposer(computedMarketUpdateProposerAddress).setGovernor(localTimelockAddress);

        MarketUpdateTimelock(payable(computedMarketUpdateTimelockAddress)).setMarketUpdateProposer(computedMarketUpdateProposerAddress);
        MarketUpdateTimelock(payable(computedMarketUpdateTimelockAddress)).setGovernor(localTimelockAddress);

        ContractDeploymentParams memory configuratorParams = ContractDeploymentParams({
            creationCode: type(Configurator).creationCode,
            constructorArgs: "",
            expectedRuntimeCode: type(Configurator).runtimeCode,
            contractName: "Configurator"
        });

        address computedConfiguratorAddress = deployContractWithCreate2(create2Deployer, salt, configuratorParams);

        ContractDeploymentParams memory cometProxyAdminParams = ContractDeploymentParams({
            creationCode: type(CometProxyAdmin).creationCode,
            constructorArgs: abi.encode(msg.sender),
            expectedRuntimeCode: type(CometProxyAdmin).runtimeCode,
            contractName: "CometProxyAdmin"
        });

        address computedCometProxyAdminAddress = deployContractWithCreate2(create2Deployer, salt, cometProxyAdminParams);
        CometProxyAdmin(computedCometProxyAdminAddress).transferOwnership(localTimelockAddress);

        console.log("Owner of cometProxyAdmin: ", CometProxyAdmin(computedCometProxyAdminAddress).owner());

        ContractDeploymentParams memory marketAdminPermissionCheckerParams = ContractDeploymentParams({
            creationCode: type(MarketAdminPermissionChecker).creationCode,
            constructorArgs: abi.encode(msg.sender, marketUpdateMultiSig, address(0)),
            expectedRuntimeCode: type(MarketAdminPermissionChecker).runtimeCode,
            contractName: "MarketAdminPermissionChecker"
        });

        address computedMarketAdminPermissionCheckerAddress = deployContractWithCreate2(create2Deployer, salt, marketAdminPermissionCheckerParams);
        MarketAdminPermissionChecker(computedMarketAdminPermissionCheckerAddress).transferOwnership(localTimelockAddress);

        return DeployedContracts({
            marketUpdateTimelock: computedMarketUpdateTimelockAddress,
            marketUpdateProposer: computedMarketUpdateProposerAddress,
            newCometProxyAdmin: computedCometProxyAdminAddress,
            newConfiguratorImplementation: computedConfiguratorAddress,
            marketAdminPermissionChecker: computedMarketAdminPermissionCheckerAddress
        });
    }

    function deployContractWithCreate2(
        ICreate2Deployer create2Deployer,
        bytes32 salt,
        ContractDeploymentParams memory params
    ) internal returns (address) {
        bytes memory bytecode = abi.encodePacked(params.creationCode, params.constructorArgs);
        address computedAddress = create2Deployer.computeAddress(salt, keccak256(bytecode));
        checkOrDeployAndCompareBytecodes(create2Deployer, salt, bytecode, computedAddress, params.expectedRuntimeCode);
        return computedAddress;
    }

    function checkOrDeployAndCompareBytecodes(
        ICreate2Deployer create2Deployer,
        bytes32 salt,
        bytes memory actualBytecode,
        address computedAddress,
        bytes memory expectedBytecode
    ) internal {
        uint256 contractCodeSize = getContractCodeSizeAtAddress(computedAddress);

        if (contractCodeSize > 0) {
            bytes memory deployedBytecode = verifyDeployedBytecode(computedAddress, contractCodeSize);

            require(
                keccak256(deployedBytecode) == keccak256(expectedBytecode),
                "Deployed bytecode does not match the expected bytecode"
            );
        } else {
            deployAndCompareBytecodes(create2Deployer, salt, actualBytecode, computedAddress, expectedBytecode);
        }
    }

    function deployAndCompareBytecodes(
        ICreate2Deployer create2Deployer,
        bytes32 salt,
        bytes memory actualBytecode,
        address computedAddress,
        bytes memory expectedBytecode
    ) internal {
        create2Deployer.deploy(0, salt, actualBytecode);

        uint256 size = getContractCodeSizeAtAddress(computedAddress);
        require(size > 0, "No contract deployed at this address");

        bytes memory deployedBytecode = new bytes(size);
        assembly {
            extcodecopy(computedAddress, add(deployedBytecode, 0x20), 0, size)
        }

        require(
            keccak256(deployedBytecode) == keccak256(expectedBytecode),
            "Deployed bytecode does not match the expected bytecode"
        );
    }

    function getContractCodeSizeAtAddress(address contractAddress) internal view returns (uint256) {
        uint256 size;
        assembly {
            size := extcodesize(contractAddress)
        }
        return size;
    }

    function verifyDeployedBytecode(address computedAddress, uint256 contractCodeSize) internal view returns (bytes memory) {
        bytes memory deployedBytecode = new bytes(contractCodeSize);
        assembly {
            extcodecopy(computedAddress, add(deployedBytecode, 0x20), 0, contractCodeSize)
        }
        return deployedBytecode;
    }
}
