// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../../contracts/Comet.sol";
import "../../contracts/CometConfiguration.sol";
import "../../contracts/liquidator/OnChainLiquidator.sol";
import "../../contracts/test/SimplePriceFeed.sol";

contract OnChainLiquidatorTest is Test {
    Comet public comet;
    OnChainLiquidator public liquidator;

    // contracts
    address public constant UNISWAP_V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

    // assets
    address public constant CB_ETH = 0xBe9895146f7AF43049ca1c1AE358B0541Ea49704;
    address public constant COMP = 0xc00e94Cb662C3520282E6f5717214004A7f26888;
    address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public constant LINK = 0x514910771AF9Ca656af840dff83E8264EcF986CA;
    address public constant ST_ETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address public constant UNI = 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address public constant WETH9 = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant WST_ETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;

    // whales
    address public constant CB_ETH_WHALE = 0xFA11D91e74fdD98F79E01582B9664143E1036931;
    address public constant COMP_WHALE = 0x2775b1c75658Be0F640272CCb8c72ac986009e38;
    address public constant LINK_WHALE = 0xfB682b0dE4e0093835EA21cfABb5449cA9ac9e5e;
    address public constant UNI_WHALE = 0x1a9C8182C09F50C8318d769245beA52c32BE35BC;
    address public constant WBTC_WHALE = 0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656;
    address public constant WETH_WHALE = 0x2F0b23f53734252Bda2277357e97e1517d6B042A;
    address public constant WST_ETH_WHALE = 0x10CD5fbe1b404B7E19Ef964B63939907bdaf42E2;

    // wallets
    address public constant LIQUIDATOR_EOA = 0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F;

    function setUp() public {
        vm.createSelectFork(string.concat("https://mainnet.infura.io/v3/", vm.envString("INFURA_KEY")));

        SimplePriceFeed wethPriceFeed = new SimplePriceFeed(1e8, 8);
        SimplePriceFeed wstEthPriceFeed = new SimplePriceFeed(98973832, 8);
        SimplePriceFeed cbEthPriceFeed = new SimplePriceFeed(98104218, 8);

        liquidator = new OnChainLiquidator(
            UNISWAP_V3_FACTORY,
            WETH9
        );

        CometConfiguration.AssetConfig[] memory assetConfigs = new CometConfiguration.AssetConfig[](2);
        assetConfigs[0] = CometConfiguration.AssetConfig({
            asset: CB_ETH,
            priceFeed: address(cbEthPriceFeed),
            decimals: 18,
            borrowCollateralFactor: 9e17,
            liquidateCollateralFactor: 93e16,
            liquidationFactor: 95e16,
            supplyCap: 0
        });
        assetConfigs[1] = CometConfiguration.AssetConfig({
            asset: WST_ETH,
            priceFeed: address(wstEthPriceFeed),
            decimals: 18,
            borrowCollateralFactor: 9e17,
            liquidateCollateralFactor: 93e16,
            liquidationFactor: 95e16,
            supplyCap: 0
        });

        // XXX all price feeds are nonsense right now
        comet = new Comet(CometConfiguration.Configuration(
            {
                governor: 0x6d903f6003cca6255D85CcA4D3B5E5146dC33925,
                pauseGuardian: 0xbbf3f1421D886E9b2c5D716B5192aC998af2012c,
                baseToken: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
                baseTokenPriceFeed: address(wethPriceFeed),
                extensionDelegate: 0x285617313887d43256F852cAE0Ee4de4b68D45B0,

                supplyKink: 8e17,
                supplyPerYearInterestRateSlopeLow: 3e16,
                supplyPerYearInterestRateSlopeHigh: 4e17,
                supplyPerYearInterestRateBase: 0,
                borrowKink: 8e17,
                borrowPerYearInterestRateSlopeLow: 3e16,
                borrowPerYearInterestRateSlopeHigh: 2e17,
                borrowPerYearInterestRateBase: 1e16,
                storeFrontPriceFactor: 5e17,
                trackingIndexScale: 1e15,
                baseTrackingSupplySpeed: 0,
                baseTrackingBorrowSpeed: 0,
                baseMinForRewards: 1000000e6,
                baseBorrowMin: 100e6,
                targetReserves: 5000000e6,
                assetConfigs: assetConfigs
            }
        ));

        // contracts
        // vm.label(AGGREGATION_ROUTER_V5, "AggregationRouterV5");
        // vm.label(COMET, "Comet");
        vm.label(UNISWAP_V3_FACTORY, "UniswapV3 Factory");

        // XXX delete
        vm.label(0xDC24316b9AE028F1497c275EB9192a3Ea0f67022, "Curve Pool");

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

    function testCbETHSwapViaUniswap() external {
        swapWithNoMax(
            CB_ETH,
            CB_ETH_WHALE,
            2000e18,
            OnChainLiquidator.PoolConfig({
                exchange: OnChainLiquidator.Exchange.Uniswap,
                uniswapPoolFee: 500,
                swapViaWeth: false,
                balancerPoolId: bytes32("")
            })
        );
    }

    function testWstETHSwapViaBalancer() external {
        swapWithNoMax(
            WST_ETH,
            WST_ETH_WHALE,
            2000e18,
            OnChainLiquidator.PoolConfig({
                exchange: OnChainLiquidator.Exchange.Balancer,
                uniswapPoolFee: 0,
                swapViaWeth: false,
                balancerPoolId: 0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080
            })
        );
    }

    function testWstETHSwapViaCurve() external {
        swapWithNoMax(
            WST_ETH,
            WST_ETH_WHALE,
            2000e18,
            OnChainLiquidator.PoolConfig({
                exchange: OnChainLiquidator.Exchange.Curve,
                uniswapPoolFee: 0,
                swapViaWeth: false,
                balancerPoolId: bytes32("")
            })
        );
    }

    function swapWithNoMax(
        address asset,
        address whale,
        uint256 transferAmount,
        OnChainLiquidator.PoolConfig memory poolConfig
    ) internal {
        uint256 initialRecipientBalance = ERC20(WETH9).balanceOf(address(this));
        int256 initialReserves = comet.getReserves();

        address[] memory liquidatableAccounts;

        OnChainLiquidator.PoolConfig[] memory poolConfigs = new OnChainLiquidator.PoolConfig[](1);
        poolConfigs[0] = poolConfig;

        uint256[] memory maxCollateralsToPurchase = new uint256[](1);
        maxCollateralsToPurchase[0] = type(uint256).max;

        address[] memory assets =  new address[](1);
        assets[0] = asset;

        vm.prank(whale);
        ERC20(asset).transfer(address(comet), transferAmount);

        liquidator.absorbAndArbitrage(
            address(comet),
            liquidatableAccounts,
            assets,
            poolConfigs,
            maxCollateralsToPurchase,
            USDC,
            500,
            10e18 // liquidation threshold
        );

        // expect that there is only dust (< 1 unit) left of the asset
        assertLt(comet.getCollateralReserves(asset), 10 ** ERC20(asset).decimals());

        // expect the base balance of the recipient to have increased
        assertGt(ERC20(WETH9).balanceOf(address(this)), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(comet.getReserves(), initialReserves);
    }

/*
    function testWstETHSwap() external {
        uint256 initialRecipientBalance = ERC20(WETH9).balanceOf(address(this));
        int256 initialReserves = comet.getReserves();

        address[] memory liquidatableAccounts;
        OnChainLiquidator.PoolConfig[] memory poolConfigs = new OnChainLiquidator.PoolConfig[](1);
        poolConfigs[0] = OnChainLiquidator.PoolConfig({
            exchange: OnChainLiquidator.Exchange.Curve,
            fee: 0,
            isLowLiquidity: false
        });

        uint256[] memory maxCollateralsToPurchase = new uint256[](1);
        maxCollateralsToPurchase[0] = type(uint256).max;

        address[] memory assets =  new address[](1);
        assets[0] = WST_ETH;

        vm.prank(WST_ETH_WHALE);
        ERC20(WST_ETH).transfer(address(comet), 100e18);

        liquidator.absorbAndArbitrage(
            address(comet),
            liquidatableAccounts,
            assets,
            poolConfigs,
            maxCollateralsToPurchase,
            USDC,
            500,
            10e18
        );

        // expect that there is only dust (< 1 unit) left of the asset
        assertLt(comet.getCollateralReserves(WST_ETH), 10 ** ERC20(WST_ETH).decimals());

        // expect the balance of the recipient to have increased
        assertGt(ERC20(WETH9).balanceOf(address(this)), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(comet.getReserves(), initialReserves);
    }
*/

/*
    function get0xSwap(
        address fromTokenAddress,
        address toTokenAddress,
        uint swapAmount
    ) internal returns (address, bytes memory) {
        string[] memory inputs = new string[](7);
        inputs[0] = "yarn";
        inputs[1] = "-s";
        inputs[2] = "ts-node";
        inputs[3] = "forge/scripts/get-0x-swap.ts";
        inputs[4] = vm.toString(fromTokenAddress);
        inputs[5] = vm.toString(toTokenAddress);
        inputs[6] = vm.toString(swapAmount);

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
        ) = liquidator.availableCollateral(COMET, liquidatableAccounts);

        uint collateralReserve;

        for (uint8 i = 0; i < assets.length; i++) {
            if (assets[i] == asset) {
                collateralReserve = collateralReserves[i];
            }
        }

        (address swapTarget, bytes memory swapTransaction) = get0xSwap(
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
            COMET,
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
        ERC20(asset).transfer(COMET, transferAmount);

        liquidator.setAssetConfig(COMET, asset, maxSwapAmount, true);

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

    function swapWithNoMax(
        address asset,
        address whale,
        uint256 transferAmount
    ) public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        vm.prank(whale);
        ERC20(asset).transfer(COMET, transferAmount);

        swap(asset);

        // expect that there is only dust (< 1 unit) left of the asset
        assertLt(CometInterface(COMET).getCollateralReserves(asset), 10 ** ERC20(asset).decimals());

        // expect the balance of the recipient to have increased
        assertGt(ERC20(USDC).balanceOf(LIQUIDATOR_EOA), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(CometInterface(COMET).getReserves(), initialReserves);
    }

    function testCompSwapWithMaxCollateral() public {
        swapWithMaxCollateral(COMP, COMP_WHALE, 40_000e18, 500e18);
    }

    function testWbtcSwapWithMaxCollateral() public {
        swapWithMaxCollateral(WBTC, WBTC_WHALE, 10_000e8, 120e8);
    }

    function testWethSwapWithMaxCollateral() public {
        swapWithMaxCollateral(WETH9, WETH_WHALE, 10_000e18, 5_000e18);
    }

    function testUniSwapWithMaxCollateral() public {
        swapWithMaxCollateral(UNI, UNI_WHALE, 500_000e18, 150_000e18);
    }

    function testLinkSwapWithMaxCollateral() public {
        swapWithMaxCollateral(LINK, LINK_WHALE, 500_000e18, 150_000e18);
    }

    function testLargeCompSwap() public {
        swapWithNoMax(COMP, COMP_WHALE, 1_500e18);
    }

    function testLargeWbtcSwap() public {
        swapWithNoMax(WBTC, WBTC_WHALE, 300e8);
    }

    function testLargeWethSwap() public {
        swapWithNoMax(WETH9, WETH_WHALE, 7_000e18);
    }

    function testLargeUniSwap() public {
        swapWithNoMax(UNI, UNI_WHALE, 250_000e18);
    }

    function testLargeLinkSwap() public {
        swapWithNoMax(LINK, LINK_WHALE, 250_000e18);
    }

    function testSwapsMultipleAssets() public {
        (uint initialRecipientBalance, int initialReserves) = initialValues();

        // test amounts must be lower in order to avoid putting the protocol
        // above targetReserves
        vm.prank(WBTC_WHALE);
        ERC20(WBTC).transfer(COMET, 10e8);

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
        ) = liquidator.availableCollateral(COMET, liquidatableAccounts);

        address[] memory swapTargets = new address[](assets.length);
        bytes[] memory swapTransactions = new bytes[](assets.length);

        address baseToken = CometInterface(COMET).baseToken();

        for (uint8 i = 0; i < assets.length; i++) {
            (address swapTarget, bytes memory swapTransaction) = get0xSwap(
                assets[i],
                baseToken,
                collateralReserves[i]
            );

            swapTargets[i] = swapTarget;
            swapTransactions[i] = swapTransaction;
        }

        liquidator.absorbAndArbitrage(
            COMET,
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

*/

}