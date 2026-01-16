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

contract MarketUpdateOptimismDeploymentTest is Test, MarketUpdateDeploymentBaseTest {

    MarketUpdateContractsDeployer.DeployedContracts deployedContracts;

    function setUp() public {
        vm.createSelectFork("optimism");
        deployedContracts = createMarketUpdateDeploymentForL2(vm, ChainAddresses.Chain.OPTIMISM);
    }

    function test_OptUsdcDeployment() public {
        console.log("Create Supply Kink Proposal for USDC Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "USDC",
            ChainAddresses.Chain.OPTIMISM,
            MarketAddresses.OPTIMISM_USDC_MARKET,
            deployedContracts
        );
    }

    function test_OptUsdtDeployment() public {
        console.log("Create Supply Kink Proposal for USDT Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "USDT",
            ChainAddresses.Chain.OPTIMISM,
            MarketAddresses.OPTIMISM_USDT_MARKET,
            deployedContracts
        );
    }

    function test_OptEthDeployment() public {
        console.log("Create Supply Kink Proposal for Eth Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "ETH",
            ChainAddresses.Chain.OPTIMISM,
            MarketAddresses.OPTIMISM_ETH_MARKET,
            deployedContracts
        );
    }
}
