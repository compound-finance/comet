// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../../contracts/Comet.sol";
import "../../contracts/CometConfiguration.sol";
import "../../contracts/liquidator/LiquidatorV2.sol";

interface WBTC {
    function owner() external returns (address);
    function mint(address _to, uint256 _amount) external returns (bool);
}

contract LiquidationBotV2Test is Test {
    LiquidatorV2 public liquidator;

    // contracts
    address public constant aggregation_router_v5 = 0x1111111254EEB25477B68fb85Ed929f73A960582;
    address public constant comet = 0xc3d688B66703497DAA19211EEdff47f25384cdc3;
    address public constant uniswap_v3_factory = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

    // assets
    address public constant comp = 0xc00e94Cb662C3520282E6f5717214004A7f26888;
    address public constant dai = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public constant link = 0x514910771AF9Ca656af840dff83E8264EcF986CA;
    address public constant uni = 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984;
    address public constant usdc = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant wbtc = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address public constant weth9 = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // whales
    address public constant comp_whale = 0x2775b1c75658Be0F640272CCb8c72ac986009e38;
    address public constant link_whale = 0xfB682b0dE4e0093835EA21cfABb5449cA9ac9e5e;
    address public constant uni_whale = 0x1a9C8182C09F50C8318d769245beA52c32BE35BC;
    address public constant weth_whale = 0x2F0b23f53734252Bda2277357e97e1517d6B042A;

    // wallets
    address public constant liquidator_eoa = 0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F;

    function setUp() public {
        liquidator = new LiquidatorV2(
            CometInterface(comet),
            address(uniswap_v3_factory),
            address(weth9),
            address(liquidator_eoa)
        );

        // contracts
        vm.label(aggregation_router_v5, "AggregationRouterV5");
        vm.label(comet, "Comet");
        vm.label(uniswap_v3_factory, "UniswapV3 Factory");

        // assets
        vm.label(comp, "COMP");
        vm.label(dai, "DAI");
        vm.label(link, "LINK");
        vm.label(uni, "UNI");
        vm.label(usdc, "USDC");
        vm.label(wbtc, "WBTC");
        vm.label(weth9, "WETH9");

        // whales
        vm.label(comp_whale, "COMP whale");
        vm.label(link_whale, "LINK whale");
        vm.label(uni_whale, "UNI whale");
        vm.label(weth_whale, "WETH whale");

        // wallets
        vm.label(liquidator_eoa, "Liquidator wallet");
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

        (
            address[] memory assets,
            uint256[] memory collateralReserves,
            uint256[] memory collateralReservesInBase
        ) = liquidator.availableCollateral(liquidatableAccounts);

        uint collateralReserveInBase;

        for (uint8 i = 0; i < assets.length; i++) {
            if (assets[i] == asset) {
                collateralReserveInBase = collateralReservesInBase[i];
            }
        }

        uint actualSwapAmount = CometInterface(comet).quoteCollateral(
            asset,
            collateralReserveInBase
        );

        (address swapTarget, bytes memory swapTransaction) = get1inchSwap(
            asset,
            CometInterface(comet).baseToken(),
            actualSwapAmount
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
            swapTransactions
        );
    }

    function initialValues() internal returns (uint, int) {
        return (
            ERC20(usdc).balanceOf(liquidator_eoa),
            CometInterface(comet).getReserves()
        );
    }

    function runSwapAssertions(
        address asset,
        uint initialRecipientBalance,
        int initialReserves
    ) internal {
        // expect that there is only dust (< 1 unit) left of the asset
        assertLt(CometInterface(comet).getCollateralReserves(asset), 10 ** ERC20(asset).decimals());

        // expect the balance of the recipient to have increased
        assertGt(ERC20(usdc).balanceOf(liquidator_eoa), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(CometInterface(comet).getReserves(), initialReserves);

        // XXX make sure that you're making > 1% of the value of the swap
    }

    function testLargeWbtcSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        address wbtcOwner = WBTC(wbtc).owner();
        vm.prank(wbtcOwner);
        WBTC(wbtc).mint(comet, 120e8); // 120 WBTC
        swap(wbtc);

        runSwapAssertions(wbtc, initialRecipientBalance, initialReserves);
    }

    function testLargeCompSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(comp_whale);
        ERC20(comp).transfer(comet, 1000e18); // 1,000 COMP
        swap(comp);

        runSwapAssertions(comp, initialRecipientBalance, initialReserves);
    }

    function testLargeWethSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(weth_whale);
        ERC20(weth9).transfer(comet, 5000e18); // 5,000 WETH
        swap(weth9);

        runSwapAssertions(weth9, initialRecipientBalance, initialReserves);
    }

    function testLargeUniSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(uni_whale);
        ERC20(uni).transfer(comet, 150000e18); // 150,000 UNI
        swap(uni);

        runSwapAssertions(uni, initialRecipientBalance, initialReserves);
    }

    function testLargeLinkSwap() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(link_whale);
        ERC20(link).transfer(comet, 250000e18); // 250,000 LINK
        swap(link);

        runSwapAssertions(link, initialRecipientBalance, initialReserves);
    }

    function testSwapsMultipleAssets() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        // test amounts must be lower in order to avoid putting the protocol
        // above targetReserves

        address wbtcOwner = WBTC(wbtc).owner();
        vm.prank(wbtcOwner);
        WBTC(wbtc).mint(comet, 10e8);

        vm.prank(comp_whale);
        ERC20(comp).transfer(comet, 100e18);

        vm.prank(weth_whale);
        ERC20(weth9).transfer(comet, 500e18);

        vm.prank(uni_whale);
        ERC20(uni).transfer(comet, 15000e18);

        vm.prank(link_whale);
        ERC20(link).transfer(comet, 25000e18);

        address[] memory liquidatableAccounts;

        (
            address[] memory assets,
            uint256[] memory collateralReserves,
            uint256[] memory collateralReservesInBase
        ) = liquidator.availableCollateral(liquidatableAccounts);

        address[] memory swapTargets = new address[](assets.length);
        bytes[] memory swapTransactions = new bytes[](assets.length);

        address baseToken = CometInterface(comet).baseToken();

        for (uint8 i = 0; i < assets.length; i++) {
            uint actualSwapAmount = CometInterface(comet).quoteCollateral(
                assets[i],
                collateralReservesInBase[i]
            );

            (address swapTarget, bytes memory swapTransaction) = get1inchSwap(
                assets[i],
                baseToken,
                actualSwapAmount
            );

            swapTargets[i] = swapTarget;
            swapTransactions[i] = swapTransaction;
        }

        liquidator.absorbAndArbitrage(
            liquidatableAccounts,
            assets,
            swapTargets,
            swapTransactions
        );

        // XXX expect that there is only dust (< 1 unit) left of the asset
        // assertLt(CometInterface(comet).getCollateralReserves(asset), 10 ** ERC20(asset).decimals());

        // expect the balance of the recipient to have increased
        assertGt(ERC20(usdc).balanceOf(liquidator_eoa), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(CometInterface(comet).getReserves(), initialReserves);
    }

    // XXX test actually liquidating an underwater account
}
