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

contract MarketUpdateBaseDeploymentTest is Test, MarketUpdateDeploymentBaseTest {

    MarketUpdateContractsDeployer.DeployedContracts deployedContracts;

    function setUp() public {
        vm.createSelectFork("base");
        deployedContracts = createMarketUpdateDeploymentForL2(vm, ChainAddresses.Chain.BASE);
    }

    function test_BaseUsdbcDeployment() public {
        console.log("Create Supply Kink Proposal for USDC Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "USDbC",
            ChainAddresses.Chain.BASE,
            MarketAddresses.BASE_USDbC_MARKET,
            deployedContracts
        );
    }

    function test_BaseUsdcDeployment() public {
        console.log("Create Supply Kink Proposal for USDT Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "USDC",
            ChainAddresses.Chain.BASE,
            MarketAddresses.BASE_USDC_MARKET,
            deployedContracts
        );
    }

    function test_BaseEthDeployment() public {
        console.log("Create Supply Kink Proposal for Eth Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "ETH",
            ChainAddresses.Chain.BASE,
            MarketAddresses.BASE_ETH_MARKET,
            deployedContracts
        );
    }
}
