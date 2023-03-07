// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../../contracts/Comet.sol";
import "../../contracts/CometConfiguration.sol";
import "../../contracts/liquidator/OnChainLiquidator.sol";
import "../../contracts/test/SimplePriceFeed.sol";

contract PolygonLiquidatorTest is Test {
    Comet public comet;
    OnChainLiquidator public liquidator;

    // contracts
    address public constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    address public constant COMET_EXT = 0x285617313887d43256F852cAE0Ee4de4b68D45B0; // XXX replace with actual address after Polygon launch
    address public constant GNOSIS_SAFE = address(0); // XXX replace with actual address after Polygon launch
    address public constant SUSHISWAP_ROUTER = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    address public constant TIMELOCK = address(0); // XXX replace with actual address after Polygon launch
    address public constant UNISWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address public constant UNISWAP_V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

    // assets
    address public constant ST_MATIC = 0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4;
    address public constant USDC = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address public constant WETH9 = 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619;
    address public constant WST_ETH = address(0); // wst_matic doesn't exist
    address public constant METADEX = 0x210E69a578CfCDbB7A829C7c6379Ac29E64A357a;
    address public constant WBTC = 0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6;
    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

    // whales
    address public constant WETH9_WHALE = 0x2093b4281990A568C9D588b8BCE3BFD7a1557Ebd;
    address public constant WBTC_WHALE = 0x2093b4281990A568C9D588b8BCE3BFD7a1557Ebd;
    address public constant WMATIC_WHALE = 0x21Cb017B40abE17B6DFb9Ba64A3Ab0f24A7e60EA;

    // price feeds
    address public constant USDC_PRICE_FEED = 0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7;
    address public constant WETH9_PRICE_FEED = 0xF9680D99D6C9589e2a93a78A04A279e509205945;
    address public constant WBTC_PRICE_FEED = 0xDE31F8bFBD8c84b5360CFACCa3539B938dd78ae6;
    address public constant WMATIC_PRICE_FEED = 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0;

    function setUp() public {
        vm.createSelectFork(string.concat("https://polygon-mainnet.infura.io/v3/", vm.envString("INFURA_KEY")));

        liquidator = new OnChainLiquidator(
            BALANCER_VAULT,
            SUSHISWAP_ROUTER,
            UNISWAP_ROUTER,
            UNISWAP_V3_FACTORY,
            ST_MATIC,
            WST_ETH,
            WETH9
        );

        CometConfiguration.AssetConfig[] memory assetConfigs = new CometConfiguration.AssetConfig[](3);
        assetConfigs[0] = CometConfiguration.AssetConfig({
            asset: WETH9,
            priceFeed: WETH9_PRICE_FEED,
            decimals: 18,
            borrowCollateralFactor: 9e17,
            liquidateCollateralFactor: 93e16,
            liquidationFactor: 95e16,
            supplyCap: 0
        });

        assetConfigs[1] = CometConfiguration.AssetConfig({
            asset: WBTC,
            priceFeed: WBTC_PRICE_FEED,
            decimals: 8,
            borrowCollateralFactor: 7e17,
            liquidateCollateralFactor: 95e16,
            liquidationFactor: 95e16,
            supplyCap: 0
        });

        assetConfigs[2] = CometConfiguration.AssetConfig({
            asset: WMATIC,
            priceFeed: WMATIC_PRICE_FEED,
            decimals: 18,
            borrowCollateralFactor: 8e17,
            liquidateCollateralFactor: 895e15,
            liquidationFactor: 95e16,
            supplyCap: 0
        });

        comet = new Comet(CometConfiguration.Configuration(
            {
                governor: TIMELOCK,
                pauseGuardian: GNOSIS_SAFE,
                baseToken: USDC,
                baseTokenPriceFeed: USDC_PRICE_FEED,
                extensionDelegate: COMET_EXT,
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
        vm.label(UNISWAP_V3_FACTORY, "UniswapV3 Factory");
        vm.label(TIMELOCK, "Timelock");
        vm.label(GNOSIS_SAFE, "Gnosis Safe");
        vm.label(COMET_EXT, "Comet Ext");

        // assets
        vm.label(ST_MATIC, "ST_MATIC");
        vm.label(USDC, "USDC");
        vm.label(WETH9, "WETH9");
        vm.label(WST_ETH, "WST_ETH");
        vm.label(METADEX, "METADEX");
        vm.label(WBTC, "WBTC");
        vm.label(WMATIC, "WMATIC");

        // whales
        vm.label(WETH9_WHALE, "WETH9_WHALE");
        vm.label(WBTC_WHALE, "WBTC_WHALE");
        vm.label(WMATIC_WHALE, "WMATIC_WHALE");
    }

    function testWETHSwapViaUniswap() external {
        swapWithNoMax(
            WETH9,
            WETH9_WHALE,
            500e18,
            OnChainLiquidator.PoolConfig({
                exchange: OnChainLiquidator.Exchange.Uniswap,
                uniswapPoolFee: 500,
                swapViaWeth: false,
                balancerPoolId: bytes32(""),
                curvePool: address(0)
            })
        );
    }

    function testWBTCSwapViaUniswap() external {
        swapWithNoMax(
            WBTC,
            WBTC_WHALE,
            30e8,
            OnChainLiquidator.PoolConfig({
                exchange: OnChainLiquidator.Exchange.Uniswap,
                uniswapPoolFee: 500,
                swapViaWeth: true,
                balancerPoolId: bytes32(""),
                curvePool: address(0)
            })
        );
    }

    function testWMATICSwapViaUniswap() external {
        swapWithNoMax(
            WMATIC,
            WMATIC_WHALE,
            500_000e18,
            OnChainLiquidator.PoolConfig({
                exchange: OnChainLiquidator.Exchange.Uniswap,
                uniswapPoolFee: 500,
                swapViaWeth: false,
                balancerPoolId: bytes32(""),
                curvePool: address(0)
            })
        );
    }

    function swapWithNoMax(
        address asset,
        address whale,
        uint256 transferAmount,
        OnChainLiquidator.PoolConfig memory poolConfig
    ) internal {
        uint256 initialRecipientBalance = ERC20(USDC).balanceOf(address(this));
        int256 initialReserves = comet.getReserves();

        address[] memory liquidatableAccounts;

        OnChainLiquidator.PoolConfig[] memory poolConfigs = new OnChainLiquidator.PoolConfig[](1);
        poolConfigs[0] = poolConfig;

        uint256[] memory maxAmountsToPurchase = new uint256[](1);
        maxAmountsToPurchase[0] = type(uint256).max;

        address[] memory assets =  new address[](1);
        assets[0] = asset;

        vm.prank(whale);
        ERC20(asset).transfer(address(comet), transferAmount);

        liquidator.absorbAndArbitrage(
            address(comet),
            liquidatableAccounts, // liquidatableAccounts
            assets,               // assets
            poolConfigs,          // poolConfigs
            maxAmountsToPurchase, // maxAmountsToPurchase
            METADEX,              // flash loan pair token
            3000,                 // flash loan pool fee
            10e6                  // liquidation threshold
        );

        // expect that there is only dust (< 1 unit) left of the asset
        assertLt(comet.getCollateralReserves(asset), 10 ** ERC20(asset).decimals());

        // expect the base balance of the recipient to have increased
        assertGt(ERC20(USDC).balanceOf(address(this)), initialRecipientBalance);

        // expect the protocol reserves to have increased
        assertGt(comet.getReserves(), initialReserves);
    }
}
