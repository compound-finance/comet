// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "./vendor/@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol";
import "./vendor/@uniswap/v3-periphery/contracts/base/PeripheryPayments.sol";
import "./vendor/@uniswap/v3-periphery/contracts/base/PeripheryImmutableState.sol";
import "./vendor/@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";
import "./vendor/@uniswap/v3-periphery/contracts/libraries/CallbackValidation.sol";
import "./vendor/@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./vendor/@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "../CometInterface.sol";
import "../ERC20.sol";
import "../IWstETH.sol";

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

// Balancer Interfaces
interface IAsset {}

interface IVault {
    enum SwapKind { GIVEN_IN, GIVEN_OUT }

    struct BatchSwapStep {
        bytes32 poolId;
        uint256 assetInIndex;
        uint256 assetOutIndex;
        uint256 amount;
        bytes userData;
    }

    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }

    function batchSwap(
        SwapKind kind,
        BatchSwapStep[] memory swaps,
        IAsset[] memory assets,
        FundManagement memory funds,
        int256[] memory limits,
        uint256 deadline
    ) external payable returns (int256[] memory);
}

// Curve Interfaces
interface ICurveRegistry {
    function find_pool_for_coins(address _from, address _to) external returns (address);
}

interface IStableSwap {
    function exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy) external payable returns (uint256);
}

/**
 * @title XXX
 * @notice XXX
 * @author Compound
 */
contract OnChainLiquidator is IUniswapV3FlashCallback, PeripheryImmutableState, PeripheryPayments {
    /** Errors */
    error InsufficientAmountOut(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 amountOutMin, Exchange exchange, uint24 fee);
    error InvalidArgument();
    error InsufficientBalance(uint256 available, uint256 required);
    error InvalidExchange();
    error InvalidPoolConfig(address swapToken, PoolConfig poolConfig);
    error Unauthorized();

    /** Events **/
    event Absorb(address indexed initiator, address[] accounts);
    event AbsorbWithoutBuyingCollateral();
    event BuyAndSwap(address indexed tokenIn, address indexed tokenOut, uint256 baseAmountPaid, uint256 assetBalance, uint256 amountOut);
    event Pay(address indexed token, address indexed payer, address indexed recipient, uint256 value);
    event Swap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, Exchange exchange, uint24 fee);

    enum Exchange {
        Uniswap,
        SushiSwap,
        Balancer,
        Curve
    }

    // XXX make this less gassy; rearrange fields
    struct PoolConfig {
        Exchange exchange;
        uint24 uniswapPoolFee;
        bool swapViaWeth;
        bytes32 balancerPoolId;
    }

    /** Liquidator configuration constants **/

    /// @notice Uniswap router used for token exchange
    address public constant uniswapRouter = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    // XXX store as address, not as IUniswapV2Router
    /// @notice SushiSwap router used for token exchange
    IUniswapV2Router public constant sushiSwapRouter = IUniswapV2Router(0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F);

    /// @notice The scale for asset price calculations
    uint256 public constant QUOTE_PRICE_SCALE = 1e18;

    /// @notice The asset pool configurations
    mapping(address => PoolConfig) public poolConfigs;

    // XXX natspecs
    constructor(address _factory, address _WETH9) PeripheryImmutableState(_factory, _WETH9) {}

    /**
     * @dev Returns lesser of two values
     */
    function min(uint256 a, uint256 b) internal view returns (uint256) {
        return a <= b ? a : b;
    }

    function purchasableBalanceOfAsset(address comet, address asset, uint maxCollateralToPurchase) internal returns (uint256, uint256) {
        uint256 collateralBalance = CometInterface(comet).getCollateralReserves(asset);

        collateralBalance = min(collateralBalance, maxCollateralToPurchase);

        uint256 baseScale = CometInterface(comet).baseScale();

        uint256 quotePrice = CometInterface(comet).quoteCollateral(asset, QUOTE_PRICE_SCALE * baseScale);
        uint256 collateralBalanceInBase = baseScale * QUOTE_PRICE_SCALE * collateralBalance / quotePrice;

        return (collateralBalance, collateralBalanceInBase);
    }

    /**
     * @notice Calls the pools flash function with data needed in `uniswapV3FlashCallback`
     */
    function absorbAndArbitrage(
        address comet,
        address[] calldata liquidatableAccounts,
        address[] calldata assets,
        PoolConfig[] calldata poolConfigs,
        uint[] calldata maxCollateralsToPurchase, // XXX rename, move into PoolConfig?
        address flashLoanPairToken,
        uint24 flashLoanPoolFee,
        uint liquidationThreshold

    ) external {
        if (poolConfigs.length != assets.length) revert InvalidArgument();
        if (maxCollateralsToPurchase.length != assets.length) revert InvalidArgument();

        // Absorb Comet underwater accounts
        CometInterface(comet).absorb(address(this), liquidatableAccounts);
        emit Absorb(msg.sender, liquidatableAccounts);

        // XXX confirm that assets and PoolConfigs are the same length

        uint256 flashLoanAmount = 0;
        uint256[] memory assetBaseAmounts = new uint256[](assets.length);

        for (uint8 i = 0; i < assets.length; i++) {
            ( , uint256 collateralBalanceInBase) = purchasableBalanceOfAsset(
                comet,
                assets[i],
                maxCollateralsToPurchase[i]
            );
            if (collateralBalanceInBase > liquidationThreshold) {
                flashLoanAmount += collateralBalanceInBase;
                assetBaseAmounts[i] = collateralBalanceInBase;
            }
        }

        // if there is nothing to buy, just absorb the accounts
        if (flashLoanAmount == 0) {
            emit AbsorbWithoutBuyingCollateral();
            return;
        }

        address poolToken0 = flashLoanPairToken;
        address poolToken1 = CometInterface(comet).baseToken();
        bool reversedPair = poolToken0 > poolToken1;
        // Use Uniswap approach to determining order of tokens https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol#L20-L27
        if (reversedPair) (poolToken0, poolToken1) = (poolToken1, poolToken0);

        // Find the desired Uniswap pool to borrow base token from, for ex DAI-USDC
        PoolAddress.PoolKey memory poolKey =
            PoolAddress.PoolKey({token0: poolToken0, token1: poolToken1, fee: flashLoanPoolFee});
        IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress.computeAddress(factory, poolKey));

        pool.flash(
            address(this),
            reversedPair ? flashLoanAmount : 0,
            reversedPair ? 0 : flashLoanAmount,
            abi.encode(
                FlashCallbackData({
                    comet: comet,
                    flashLoanAmount: flashLoanAmount,
                    recipient: msg.sender,
                    poolKey: poolKey,
                    assets: assets,
                    assetBaseAmounts: assetBaseAmounts,
                    poolConfigs: poolConfigs
                })
            )
        );
    }

    struct FlashCallbackData {
        address comet;
        uint256 flashLoanAmount;
        address recipient;
        PoolAddress.PoolKey poolKey;
        address[] assets;
        uint256[] assetBaseAmounts;
        PoolConfig[] poolConfigs;
    }

    /**
     * @notice Uniswap flashloan callback
     * @param fee0 The fee for borrowing token0 from pool
     * @param fee1 The fee for borrowing token1 from pool
     * @param data The encoded data passed from loan initiation function
     */
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        // Verify uniswap callback, recommended security measure
        FlashCallbackData memory flashCallbackData = abi.decode(data, (FlashCallbackData));
        CallbackValidation.verifyCallback(factory, flashCallbackData.poolKey);

        address[] memory assets = flashCallbackData.assets;

        address baseToken = CometInterface(flashCallbackData.comet).baseToken();

        // Allow Comet protocol to withdraw USDC (base token) for collateral purchase
        TransferHelper.safeApprove(baseToken, address(flashCallbackData.comet), flashCallbackData.flashLoanAmount);

        uint256 totalAmountOut = 0;
        for (uint i = 0; i < assets.length; i++) {
            address asset = assets[i];
            uint256 assetBaseAmount = flashCallbackData.assetBaseAmounts[i];

            if (assetBaseAmount == 0) continue;

            CometInterface(flashCallbackData.comet).buyCollateral(asset, 0, assetBaseAmount, address(this));

            uint256 assetBalance = ERC20(asset).balanceOf(address(this));

            uint256 amountOut = swapCollateral(
                flashCallbackData.comet,
                asset,
                assetBaseAmount,
                flashCallbackData.poolConfigs[i]
            );

            emit BuyAndSwap(asset, baseToken, assetBaseAmount, assetBalance, amountOut);

            totalAmountOut += amountOut;
        }

        // We borrow only 1 asset, so one of fees will be 0
        // XXX delete?
        uint256 fee = fee0 + fee1;
        // Payback flashloan to Uniswap pool and profit to the caller
        // payback(flashCallbackData.amount, fee, baseToken, totalAmountOut);

        address recipient = flashCallbackData.recipient;
        uint256 totalAmountOwed = flashCallbackData.flashLoanAmount + fee0 + fee1;
        uint256 balance = ERC20(baseToken).balanceOf(address(this));

        if (totalAmountOwed > balance) {
            revert InsufficientBalance(balance, totalAmountOwed);
        }

        TransferHelper.safeApprove(baseToken, address(this), totalAmountOwed);

        // Repay the loan
        if (totalAmountOwed > 0) {
            pay(baseToken, address(this), msg.sender, totalAmountOwed);
            emit Pay(baseToken, address(this), msg.sender, totalAmountOwed);
        }

        uint256 remainingBalance = ERC20(baseToken).balanceOf(address(this));

        // If profitable, pay profits to the original caller
        if (remainingBalance > 0) {
            TransferHelper.safeApprove(baseToken, address(this), remainingBalance);
            pay(baseToken, address(this), recipient, remainingBalance);
            emit Pay(baseToken, address(this), recipient, remainingBalance);
        }

    }

    function swapCollateral(
        address comet,
        address asset,
        uint256 amountOutMin,
        PoolConfig memory poolConfig
    ) internal returns (uint256) {
        if (poolConfig.exchange == Exchange.Uniswap) {
            return swapViaUniswap(comet, asset, amountOutMin, poolConfig);
        } else if (poolConfig.exchange == Exchange.SushiSwap) {
            return swapViaSushiSwap(comet, asset, amountOutMin, poolConfig);
        } else if (poolConfig.exchange == Exchange.Balancer) {
            return swapViaBalancer(comet, asset, amountOutMin, poolConfig);
        } else if (poolConfig.exchange == Exchange.Curve) {
            return swapViaCurve(comet, asset, amountOutMin, poolConfig);
        } else {
            revert InvalidExchange();
        }
    }

    /**
     * @dev Swaps the given asset to USDC (base token) using Uniswap pools
     */
    function swapViaUniswap(address comet, address asset, uint256 amountOutMin, PoolConfig memory poolConfig) internal returns (uint256) {
        uint256 swapAmount = ERC20(asset).balanceOf(address(this));
        // Safety check, make sure residue balance in protocol is ignored
        if (swapAmount == 0) return 0;

        uint24 poolFee = poolConfig.uniswapPoolFee;

        if (poolFee == 0) {
            revert InvalidPoolConfig(asset, poolConfig);
        }

        address swapToken = asset;

        address baseToken = CometInterface(comet).baseToken();

        TransferHelper.safeApprove(asset, address(uniswapRouter), swapAmount);
        // For low liquidity asset, swap it to ETH first
        if (poolConfig.swapViaWeth) {
            uint256 swapAmountNew = ISwapRouter(uniswapRouter).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: asset,
                    tokenOut: WETH9,
                    fee: poolFee,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: swapAmount,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
            emit Swap(asset, WETH9, swapAmount, swapAmountNew, Exchange.Uniswap, poolFee);
            swapAmount = swapAmountNew;
            swapToken = WETH9;
            poolFee = 500; // XXX move into constant

            TransferHelper.safeApprove(WETH9, address(uniswapRouter), swapAmount);
        }

        // Swap asset or received ETH to base asset
        uint256 amountOut = ISwapRouter(uniswapRouter).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: swapToken,
                tokenOut: baseToken,
                fee: poolFee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: swapAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        // we do a manual check against `amountOutMin` (instead of specifying an
        // `amountOutMinimum` in the swap) so we can provide better information
        // in the error message
        if (amountOut < amountOutMin) {
            // XXX test the error messaging on Goerli
            revert InsufficientAmountOut(swapToken, baseToken, swapAmount, amountOut, amountOutMin, Exchange.Uniswap, poolFee);
        }

        emit Swap(swapToken, baseToken, swapAmount, amountOut, Exchange.Uniswap, poolFee);

        return amountOut;
    }

    /**
     * @dev Swaps the given asset to USDC (base token) using Sushi Swap pools
     */
    function swapViaSushiSwap(address comet, address asset, uint256 amountOutMin, PoolConfig memory poolConfig) internal returns (uint256) {
        uint256 swapAmount = ERC20(asset).balanceOf(address(this));
        // Safety check, make sure residue balance in protocol is ignored
        if (swapAmount == 0) return 0;

        address swapToken = asset;

        address baseToken = CometInterface(comet).baseToken();

        TransferHelper.safeApprove(asset, address(sushiSwapRouter), swapAmount);

        address[] memory path;
        if (poolConfig.swapViaWeth) {
            path = new address[](3);
            path[0] = swapToken;
            path[1] = WETH9;
            path[2] = baseToken;
        } else {
            path = new address[](2);
            path[0] = swapToken;
            path[1] = baseToken;
        }

        // XXX
        uint256[] memory amounts = sushiSwapRouter.swapExactTokensForTokens(
            swapAmount,
            0,
            path,
            address(this),
            block.timestamp
        );
        uint256 amountOut = amounts[amounts.length - 1];

        // we do a manual check against `amountOutMin` (instead of specifying an
        // `amountOutMinimum` in the swap) so we can provide better information
        // in the error message
        if (amountOut < amountOutMin) {
            // XXX test the error messaging on Goerli
            revert InsufficientAmountOut(swapToken, baseToken, swapAmount, amountOut, amountOutMin, Exchange.SushiSwap, 3000);
        }

        emit Swap(swapToken, baseToken, swapAmount, amountOut, Exchange.SushiSwap, 3000);

        return amountOut;
    }

    function swapViaBalancer(address comet, address asset, uint256 amountOutMin, PoolConfig memory poolConfig) internal returns (uint256) {
        uint256 swapAmount = ERC20(asset).balanceOf(address(this));
        // Safety check, make sure residue balance in protocol is ignored
        if (swapAmount == 0) return 0;

        address swapToken = asset;

        address baseToken = CometInterface(comet).baseToken();

        // XXX move?
        address BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

        TransferHelper.safeApprove(asset, address(BALANCER_VAULT), swapAmount);

        int256[] memory limits = new int256[](2);
        limits[0] = type(int256).max;
        limits[1] = type(int256).max;

        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(asset);
        assets[1] = IAsset(baseToken);

        IVault.BatchSwapStep[] memory steps = new IVault.BatchSwapStep[](1);
        steps[0] = IVault.BatchSwapStep({
            poolId: poolConfig.balancerPoolId,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: swapAmount,
            userData: bytes("")
        });

        int256[] memory assetDeltas = IVault(BALANCER_VAULT).batchSwap(
            IVault.SwapKind.GIVEN_IN,
            steps,
            assets,
            IVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(this),
                toInternalBalance: false
            }),
            limits, // limits
            block.timestamp
        );

        int256 signedAmountOut = -assetDeltas[assetDeltas.length - 1];

        if (signedAmountOut < 0) {
            // XXX custom error
            revert("signedAmoutOut cannot be negative");
        }

        uint256 amountOut = uint256(signedAmountOut);

        if (amountOut < amountOutMin) {
            revert InsufficientAmountOut(swapToken, baseToken, swapAmount, amountOut, amountOutMin, Exchange.Balancer, 0);
        }

        return amountOut;
    }

    function swapViaCurve(address comet, address asset, uint256 amountOutMin, PoolConfig memory poolConfig) internal returns (uint256) {
        uint256 swapAmount = ERC20(asset).balanceOf(address(this));
        // Safety check, make sure residue balance in protocol is ignored
        if (swapAmount == 0) return 0;

        address swapToken = asset;
        address baseToken = CometInterface(comet).baseToken();

        address CURVE_REGISTRY = 0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5;
        address ST_ETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
        address WST_ETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
        address ALL_EES = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

        // unwrap wstETH
        if (swapToken == WST_ETH) {
            swapAmount = IWstETH(WST_ETH).unwrap(swapAmount);
            swapToken = ST_ETH;
        }

        address curvePool = ICurveRegistry(CURVE_REGISTRY).find_pool_for_coins(
            swapToken,
            ALL_EES
        );

        TransferHelper.safeApprove(swapToken, address(curvePool), swapAmount);

        uint amountOut = IStableSwap(curvePool).exchange(
            1,
            0,
            swapAmount,
            0
        );

        // XXX only do when token received is ETH
        IWETH9(WETH9).deposit{value: amountOut}();
        uint256 balanceWETH9 = IWETH9(WETH9).balanceOf(address(this));

        return balanceWETH9;
    }

    receive() external payable {}
}
