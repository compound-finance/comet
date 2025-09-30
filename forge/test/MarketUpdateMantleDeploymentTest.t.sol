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

contract MarketUpdateMantleDeploymentTest is Test, MarketUpdateDeploymentBaseTest {

    MarketUpdateContractsDeployer.DeployedContracts deployedContracts;

    function setUp() public {
        vm.createSelectFork("mantle");
        deployedContracts = createMarketUpdateDeploymentForL2(vm, ChainAddresses.Chain.MANTLE);
    }

    function test_MantleUSDeDeployment() public {
        console.log("Create Supply Kink Proposal for USDCe Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "cUSDev3",
            ChainAddresses.Chain.MANTLE,
            MarketAddresses.MANTLE_USDe_MARKET,
            deployedContracts
        );
    }
}
