// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../../contracts/Comet.sol";
import "../../contracts/CometConfiguration.sol";
import "../../contracts/liquidator/LiquidatorV2.sol";

interface WbtcInterface {
    function owner() external returns (address);
    function mint(address _to, uint256 _amount) external returns (bool);
}

contract LiquidationBotV2Test is Test {
    LiquidatorV2 public liquidator;

    // contracts
    address public constant AGGREGATION_ROUTER_V5 = 0x1111111254EEB25477B68fb85Ed929f73A960582;
    address public constant COMET = 0xc3d688B66703497DAA19211EEdff47f25384cdc3;
    address public constant UNISWAP_V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

    // assets
    address public constant COMP = 0xc00e94Cb662C3520282E6f5717214004A7f26888;
    address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public constant LINK = 0x514910771AF9Ca656af840dff83E8264EcF986CA;
    address public constant UNI = 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address public constant WETH9 = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // whales
    address public constant COMP_WHALE = 0x2775b1c75658Be0F640272CCb8c72ac986009e38;
    address public constant LINK_WHALE = 0xfB682b0dE4e0093835EA21cfABb5449cA9ac9e5e;
    address public constant UNI_WHALE = 0x1a9C8182C09F50C8318d769245beA52c32BE35BC;
    address public constant WBTC_WHALE = 0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656;
    address public constant WETH_WHALE = 0x2F0b23f53734252Bda2277357e97e1517d6B042A;

    // wallets
    address public constant LIQUIDATOR_EOA = 0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F;

    function setUp() public {
        vm.createSelectFork(string.concat("https://mainnet.infura.io/v3/", vm.envString("INFURA_KEY")));

        liquidator = new LiquidatorV2(
            CometInterface(COMET),
            address(UNISWAP_V3_FACTORY),
            address(WETH9),
            address(LIQUIDATOR_EOA)
        );

        // contracts
        vm.label(AGGREGATION_ROUTER_V5, "AggregationRouterV5");
        vm.label(COMET, "Comet");
        vm.label(UNISWAP_V3_FACTORY, "UniswapV3 Factory");

        // assets
        vm.label(COMP, "COMP");
        vm.label(DAI, "DAI");
        vm.label(LINK, "LINK");
        vm.label(UNI, "UNI");
        vm.label(USDC, "USDC");
        vm.label(WBTC, "WBTC");
        vm.label(WETH9, "WETH9");

        // whales
        vm.label(COMP_WHALE, "COMP whale");
        vm.label(LINK_WHALE, "LINK whale");
        vm.label(UNI_WHALE, "UNI whale");
        vm.label(WETH_WHALE, "WETH whale");

        // wallets
        vm.label(LIQUIDATOR_EOA, "Liquidator wallet");
    }

    function get1inchSwap(
        address fromTokenAddress,
        address toTokenAddress,
        uint swapAmount
    ) internal returns (address, bytes memory) {
        string[] memory inputs = new string[](8);
        inputs[0] = "yarn";
        inputs[1] = "-s";
        inputs[2] = "ts-node";
        inputs[3] = "forge/scripts/get-1inch-swap.ts";
        inputs[4] = vm.toString(address(liquidator));
        inputs[5] = vm.toString(fromTokenAddress);
        inputs[6] = vm.toString(toTokenAddress);
        inputs[7] = vm.toString(swapAmount);

        string memory responseJson = string(vm.ffi(inputs));

        return (
            abi.decode(vm.parseJson(responseJson, ".target"), (address)),
            abi.decode(vm.parseJson(responseJson, ".tx"), (bytes))
        );
    }

    function swap(address asset) public {
        address[] memory liquidatableAccounts;

        // XXX not a static call; will actually absorb the liquidatableAccounts
        (
            address[] memory assets,
            uint256[] memory collateralReserves,
            uint256[] memory collateralReservesInBase
        ) = liquidator.availableCollateral(liquidatableAccounts);

        uint collateralReserve;

        for (uint8 i = 0; i < assets.length; i++) {
            if (assets[i] == asset) {
                collateralReserve = collateralReserves[i];
            }
        }

        (address swapTarget, bytes memory swapTransaction) = get1inchSwap(
            asset,
            CometInterface(COMET).baseToken(),
            collateralReserve
        );

        address[] memory swapAssets = new address[](1);
        swapAssets[0] = asset;

        address[] memory swapTargets = new address[](1);
        swapTargets[0] = swapTarget;

        bytes[] memory swapTransactions = new bytes[](1);
        swapTransactions[0] = swapTransaction;

        liquidator.absorbAndArbitrage(
            liquidatableAccounts,
            swapAssets,
            swapTargets,
            swapTransactions,
            DAI,
            100
        );
    }

    function initialValues() internal returns (uint, int) {
        return (
            ERC20(USDC).balanceOf(LIQUIDATOR_EOA),
            CometInterface(COMET).getReserves()
        );
    }

    function runSwapAssertions(
        address asset,
        uint initialRecipientBalance,
        int initialReserves
    ) internal {
        // expect that there is only dust (< 1 unit) left of the asset
        assertLt(CometInterface(COMET).getCollateralReserves(asset), 10 ** ERC20(asset).decimals());

        // expect the balance of the recipient to have increased
        assertGt(ERC20(USDC).balanceOf(LIQUIDATOR_EOA), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(CometInterface(COMET).getReserves(), initialReserves);

        // XXX make sure that you're making > 1% of the value of the swap
    }

    function swapWithMaxCollateral(
        address asset,
        address whale,
        uint256 transferAmount,
        uint maxSwapAmount
    ) public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(whale);
        ERC20(asset).transfer(COMET, transferAmount); // 40,000 COMP for sale (an amount we can't clear all at once)

        liquidator.setAssetConfig(asset, maxSwapAmount, true);

        swap(asset);

        // expect that there is still a significant amount of asset owned by the protocol
        assertApproxEqAbs(
            CometInterface(COMET).getCollateralReserves(asset),
            transferAmount - maxSwapAmount,
            10 ** ERC20(asset).decimals() // diff should be within 1 unit of asset
        );

        // expect the balance of the recipient to have increased
        assertGt(ERC20(USDC).balanceOf(LIQUIDATOR_EOA), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(CometInterface(COMET).getReserves(), initialReserves);
    }

    function testCompSwapWithMaxCollateral() public {
        swapWithMaxCollateral(COMP, COMP_WHALE, 40_000e18, 500e18);
    }

    // wbtc
    function testWbtcSwapWithMaxCollateral() public {
        swapWithMaxCollateral(WBTC, WBTC_WHALE, 10_000e8, 120e8);
    }

    // weth
    function testWethSwapWithMaxCollateral() public {
        swapWithMaxCollateral(WETH9, WETH_WHALE, 10_000e18, 5_000e18);
    }

    // uni
    function testUniSwapWithMaxCollateral() public {
        swapWithMaxCollateral(UNI, UNI_WHALE, 500_000e18, 150_000e18);
    }

    // link
    function testLinkSwapWithMaxCollateral() public {
        swapWithMaxCollateral(LINK, LINK_WHALE, 500_000e18, 150_000e18);
    }

    function testLargeWbtcSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        address wbtcOwner = WbtcInterface(WBTC).owner();
        vm.prank(wbtcOwner);
        WbtcInterface(WBTC).mint(COMET, 120e8); // 120 WBTC
        swap(WBTC);

        runSwapAssertions(WBTC, initialRecipientBalance, initialReserves);
    }

    function testLargeCompSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(COMP_WHALE);
        ERC20(COMP).transfer(COMET, 2_000e18); // 2,000 COMP
        swap(COMP);

        runSwapAssertions(COMP, initialRecipientBalance, initialReserves);
    }

    function testLargeWethSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(WETH_WHALE);
        ERC20(WETH9).transfer(COMET, 5_000e18); // 5,000 WETH
        swap(WETH9);

        runSwapAssertions(WETH9, initialRecipientBalance, initialReserves);
    }

    function testLargeUniSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(UNI_WHALE);
        ERC20(UNI).transfer(COMET, 500_000e18); // 500K UNI
        swap(UNI);

        runSwapAssertions(UNI, initialRecipientBalance, initialReserves);
    }

    function testLargeLinkSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(LINK_WHALE);
        ERC20(LINK).transfer(COMET, 250_000e18); // 250,000 LINK
        swap(LINK);

        runSwapAssertions(LINK, initialRecipientBalance, initialReserves);
    }

    function testSwapsMultipleAssets() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        // test amounts must be lower in order to avoid putting the protocol
        // above targetReserves

        address wbtcOwner = WbtcInterface(WBTC).owner();
        vm.prank(wbtcOwner);
        WbtcInterface(WBTC).mint(COMET, 10e8);

        vm.prank(COMP_WHALE);
        ERC20(COMP).transfer(COMET, 100e18);

        vm.prank(WETH_WHALE);
        ERC20(WETH9).transfer(COMET, 500e18);

        vm.prank(UNI_WHALE);
        ERC20(UNI).transfer(COMET, 15_000e18);

        vm.prank(LINK_WHALE);
        ERC20(LINK).transfer(COMET, 25_000e18);

        address[] memory liquidatableAccounts;

        // XXX not a static call; will actually absorb the liquidatableAccounts
        (
            address[] memory assets,
            uint256[] memory collateralReserves,
            uint256[] memory collateralReservesInBase
        ) = liquidator.availableCollateral(liquidatableAccounts);

        address[] memory swapTargets = new address[](assets.length);
        bytes[] memory swapTransactions = new bytes[](assets.length);

        address baseToken = CometInterface(COMET).baseToken();

        for (uint8 i = 0; i < assets.length; i++) {
            (address swapTarget, bytes memory swapTransaction) = get1inchSwap(
                assets[i],
                baseToken,
                collateralReserves[i]
            );

            swapTargets[i] = swapTarget;
            swapTransactions[i] = swapTransaction;
        }

        liquidator.absorbAndArbitrage(
            liquidatableAccounts,
            assets,
            swapTargets,
            swapTransactions,
            DAI,
            100
        );

        // XXX expect that there is only dust (< 1 unit) left of the asset
        // assertLt(CometInterface(comet).getCollateralReserves(asset), 10 ** ERC20(asset).decimals());

        // expect the balance of the recipient to have increased
        assertGt(ERC20(USDC).balanceOf(LIQUIDATOR_EOA), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(CometInterface(COMET).getReserves(), initialReserves);
    }

    // XXX test actually liquidating an underwater account
}
