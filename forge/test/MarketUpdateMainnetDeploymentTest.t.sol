pragma solidity 0.8.15;

import {Test} from "forge-std/Test.sol";
import "@comet-contracts/Comet.sol";
import "@comet-contracts/marketupdates/MarketUpdateProposer.sol";

import "../script/marketupdates/helpers/GovernanceHelper.sol";
import "../script/marketupdates/helpers/MarketUpdateAddresses.sol";
import "../script/marketupdates/helpers/MarketUpdateContractsDeployer.sol";
import "../script/marketupdates/helpers/ChainAddresses.sol";
import "../script/marketupdates/helpers/MarketAddresses.sol";
import "../script/marketupdates/helpers/GovernanceHelper.sol";
import "./MarketUpdateDeploymentBaseTest.sol";

contract MarketUpdateMainnetDeploymentTest is MarketUpdateDeploymentBaseTest {

    MarketUpdateContractsDeployer.DeployedContracts internal deployedContracts;
    ChainAddresses.ChainAddressesStruct internal chainAddresses;

    function setUp() public {
        vm.createSelectFork("mainnet");
        deployedContracts = createMarketUpdateDeployment(vm);
        chainAddresses = ChainAddresses.getChainAddresses(ChainAddresses.Chain.ETHEREUM);
    }

    function test_UsdcDeployment() public {
        console.log("Create Supply Kink Proposal for USDC Market and verify after execution");

        updateAndVerifySupplyKink(
            vm,
            "USDC",
            MarketAddresses.MAINNET_USDC_MARKET,
            chainAddresses,
            deployedContracts
        );
    }

    function test_UsdtDeployment() public {
        console.log("Create Supply Kink Proposal for USDT Market and verify after execution");

        updateAndVerifySupplyKink(
            vm,
            "USDT",
            MarketAddresses.MAINNET_USDT_MARKET,
            chainAddresses,
            deployedContracts

        );
    }

    function test_EthDeployment() public {
        console.log("Create Supply Kink Proposal for ETH Market and verify after execution");

        updateAndVerifySupplyKink(
            vm,
            "ETH",
            MarketAddresses.MAINNET_ETH_MARKET,
            chainAddresses,
            deployedContracts
        );
    }

    function test_WstEthDeployment() public {
        console.log("Create Supply Kink Proposal for WST_ETH Market and verify after execution");

        updateAndVerifySupplyKink(
            vm,
            "WST_ETH",
            MarketAddresses.MAINNET_WST_ETH_MARKET,
            chainAddresses,
            deployedContracts
        );
    }
}
