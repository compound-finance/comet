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

contract MarketUpdateArbitrumDeploymentTest is Test, MarketUpdateDeploymentBaseTest {

    MarketUpdateContractsDeployer.DeployedContracts deployedContracts;

    function setUp() public {
        vm.createSelectFork("arbitrum");
        deployedContracts = createMarketUpdateDeploymentForL2(vm, ChainAddresses.Chain.ARBITRUM);
    }

    function test_ArbUsdcDeployment() public {
        console.log("Create Supply Kink Proposal for USDC Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "USDC",
            ChainAddresses.Chain.ARBITRUM,
            MarketAddresses.ARBITRUM_USDC_MARKET,
            deployedContracts
        );
    }

    function test_ArbUsdceDeployment() public {
        console.log("Create Supply Kink Proposal for USDCe Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "USDCe",
            ChainAddresses.Chain.ARBITRUM,
            MarketAddresses.ARBITRUM_USDCe_MARKET,
            deployedContracts

        );
    }

    function test_ArbUsdtDeployment() public {
        console.log("Create Supply Kink Proposal for USDT Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "USDT",
            ChainAddresses.Chain.ARBITRUM,
            MarketAddresses.ARBITRUM_USDT_MARKET,
            deployedContracts

        );
    }

    function test_ArbEthDeployment() public {
        console.log("Create Supply Kink Proposal for Eth Market and verify after execution");

        updateAndVerifySupplyKinkInL2(
            vm,
            "ETH",
            ChainAddresses.Chain.ARBITRUM,
            MarketAddresses.ARBITRUM_ETH_MARKET,
            deployedContracts
        );
    }
}
