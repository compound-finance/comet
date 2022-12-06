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

    function testLargeSwaps() public {
        address wbtcOwner = WBTC(wbtc).owner();

        vm.prank(wbtcOwner);
        WBTC(wbtc).mint(comet, 120e8);

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

            if (returnedCollateralReservesInBase[i] > 10e6) {
                string[] memory inputs = new string[](8);
                inputs[0] = "yarn";
                inputs[1] = "-s";
                inputs[2] = "ts-node";
                inputs[3] = "forge/scripts/get-1inch-swap.ts";
                inputs[4] = vm.toString(address(liquidator));
                inputs[5] = vm.toString(returnedAssets[i]);
                inputs[6] = vm.toString(usdc); // comet base token
                inputs[7] = vm.toString(returnedCollateralReserves[i] - 1); //

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

            }

        }

    }

    /*
    function test3

      send an amount of each token to the protocol

      get available collateral for each amount

      [wbtc, weth, comp, link] for each
        pass fromTokenAddress, amount to get-1inch-swap.ts
        pass swapTarget, swapTx to absorbAndArbitrage()

        assert that the absorb/arbitrage went through

    */

}
