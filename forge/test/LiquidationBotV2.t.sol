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
    address public constant comet = 0xc3d688B66703497DAA19211EEdff47f25384cdc3;
    address public constant uniswap_v3_factory = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address public constant aggregation_router_v5 = 0x1111111254EEB25477B68fb85Ed929f73A960582;
    address public constant compound_reservoir = 0x2775b1c75658Be0F640272CCb8c72ac986009e38;

    // assets
    address public constant weth9 = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant usdc = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant dai = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public constant wbtc = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address public constant comp = 0xc00e94Cb662C3520282E6f5717214004A7f26888;
    address public constant uni = 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984;
    address public constant link = 0x514910771AF9Ca656af840dff83E8264EcF986CA;

    // wallets
    address public constant recipient = 0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F;
    address public constant weth_whale = 0x2F0b23f53734252Bda2277357e97e1517d6B042A;
    address public constant uni_whale = 0x1a9C8182C09F50C8318d769245beA52c32BE35BC;
    address public constant link_whale = 0xfB682b0dE4e0093835EA21cfABb5449cA9ac9e5e;

    function setUp() public {
        liquidator = new LiquidatorV2(
            CometInterface(comet),
            address(uniswap_v3_factory),
            address(weth9),
            address(recipient)
        );

        // contracts
        vm.label(comet, "Comet");
        vm.label(aggregation_router_v5, "AggregationRouterV5");

        // assets
        vm.label(dai, "DAI");
        vm.label(comp, "COMP");
        vm.label(link, "LINK");
        vm.label(uni, "UNI");
        vm.label(usdc, "USDC");
        vm.label(wbtc, "WBTC");
        vm.label(weth9, "WETH9");
    }

    function SKIPlargeSwaps() public {
        // send 120 WBTC
        // WBTC ' == 120',
        address wbtcOwner = WBTC(wbtc).owner();
        vm.prank(wbtcOwner);
        WBTC(wbtc).mint(comet, 120e8);

        // COMP ' == 500',
        vm.prank(compound_reservoir);
        ERC20(comp).transfer(comet, 1000e18);

        // WETH ' == 5000',
        vm.prank(weth_whale);
        ERC20(weth9).transfer(comet, 5000e18);

        // UNI ' == 150000',
        vm.prank(uni_whale);
        ERC20(uni).transfer(comet, 150000e18);

        // LINK ' == 250000',
        vm.prank(link_whale);
        ERC20(link).transfer(comet, 250000e18);

        address[] memory liquidatableAccounts;

        (
            address[] memory returnedAssets,
            uint256[] memory returnedCollateralReserves,
            uint256[] memory returnedCollateralReservesInBase
        ) = liquidator.availableCollateral(liquidatableAccounts);

        for (uint8 i = 0; i < returnedAssets.length; i++) {
            console.log("loop: %s", i);
            console.log(returnedAssets[i]);
            console.log(returnedCollateralReserves[i]);
            console.log(returnedCollateralReservesInBase[i]);

            // NOTE: may struggle to swap dust
            if (returnedCollateralReservesInBase[i] > 10e6) {
                uint actualSwapAmount = CometInterface(comet).quoteCollateral(
                    returnedAssets[i],
                    returnedCollateralReservesInBase[i]
                );

                console.log("actualSwapAmount: %s", actualSwapAmount);

                string[] memory inputs = new string[](8);
                inputs[0] = "yarn";
                inputs[1] = "-s";
                inputs[2] = "ts-node";
                inputs[3] = "forge/scripts/get-1inch-swap.ts";
                inputs[4] = vm.toString(address(liquidator));
                inputs[5] = vm.toString(returnedAssets[i]);
                inputs[6] = vm.toString(usdc); // XXX comet base token
                inputs[7] = vm.toString(actualSwapAmount);

                bytes memory res = vm.ffi(inputs);
                string memory resJson = string(res);

                address[] memory assets = new address[](1);
                assets[0] = returnedAssets[i];

                address[] memory swapTargets = new address[](1);
                swapTargets[0] = abi.decode(vm.parseJson(resJson, ".target"), (address));

                bytes[] memory swapTransactions = new bytes[](1);
                swapTransactions[0] = abi.decode(vm.parseJson(resJson, ".tx"), (bytes));

                liquidator.absorbAndArbitrage(
                    liquidatableAccounts, // empty list
                    assets, // assets,
                    swapTargets, // swapTargets,
                    swapTransactions // swapTransactions
                );

                // make sure that you're making > 1% of the value of the swap
                console.log("comet.getReserves():");
                console.logInt(CometInterface(comet).getReserves());
            }
        }
    }

    function testLargeWbtcSwap() public {
        console.log("comet.getReserves():");
        console.logInt(CometInterface(comet).getReserves());

        address wbtcOwner = WBTC(wbtc).owner();
        vm.prank(wbtcOwner);
        WBTC(wbtc).mint(comet, 120e8); // 120 WBTC
        swap(wbtc);
    }

    function testLargeCompSwap() public {
        console.log("comet.getReserves():");
        console.logInt(CometInterface(comet).getReserves());

        vm.prank(compound_reservoir);
        ERC20(comp).transfer(comet, 1000e18); // 1,000 COMP
        swap(comp);
    }

    function testLargeWethSwap() public {
        console.log("comet.getReserves():");
        console.logInt(CometInterface(comet).getReserves());

        vm.prank(weth_whale);
        ERC20(weth9).transfer(comet, 5000e18); // 5,000 WETH
        swap(weth9);
    }

    function testLargeUniSwap() public {
        console.log("comet.getReserves():");
        console.logInt(CometInterface(comet).getReserves());

        vm.prank(uni_whale);
        ERC20(uni).transfer(comet, 150000e18); // 150,000 UNI
        swap(uni);
    }

    function testLargeLinkSwap() public {
        console.log("comet.getReserves():");
        console.logInt(CometInterface(comet).getReserves());

        vm.prank(link_whale);
        ERC20(link).transfer(comet, 250000e18); // 250,000 LINK
        swap(link);
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

        console.log("actualSwapAmount: %s", actualSwapAmount);

        string[] memory inputs = new string[](8);
        inputs[0] = "yarn";
        inputs[1] = "-s";
        inputs[2] = "ts-node";
        inputs[3] = "forge/scripts/get-1inch-swap.ts";
        inputs[4] = vm.toString(address(liquidator));
        inputs[5] = vm.toString(asset);
        inputs[6] = vm.toString(usdc); // XXX comet base token
        inputs[7] = vm.toString(actualSwapAmount);

        bytes memory res = vm.ffi(inputs);
        string memory resJson = string(res);

        address[] memory swapAssets = new address[](1);
        swapAssets[0] = asset;

        address[] memory swapTargets = new address[](1);
        swapTargets[0] = abi.decode(vm.parseJson(resJson, ".target"), (address));

        bytes[] memory swapTransactions = new bytes[](1);
        swapTransactions[0] = abi.decode(vm.parseJson(resJson, ".tx"), (bytes));

        liquidator.absorbAndArbitrage(
            liquidatableAccounts, // empty list
            swapAssets, // assets,
            swapTargets, // swapTargets,
            swapTransactions // swapTransactions
        );

        // make sure that you're making > 1% of the value of the swap
        console.log("comet.getReserves():");
        console.logInt(CometInterface(comet).getReserves());
    }
}
