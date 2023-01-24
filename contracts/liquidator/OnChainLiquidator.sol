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
import "./interfaces/IStableSwap.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./interfaces/IVault.sol";

/**
 * @title Compound's on-chain liquidation contract
 * @author Compound
 */
contract OnChainLiquidator is IUniswapV3FlashCallback, PeripheryImmutableState, PeripheryPayments {
    /** Errors */
    error InsufficientAmountOut(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 amountOutMin, PoolConfig poolConfig);
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
    event Swap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, PoolConfig poolConfig);

    enum Exchange {
        Uniswap,
        SushiSwap,
        Balancer,
        Curve
    }

    // XXX make this less gassy; rearrange fields
    struct PoolConfig {
        Exchange exchange;      // which exchange the config applies to
        uint24 uniswapPoolFee;  // fee for the swap pool (e.g. 3000, 500, 100); only applies to Uniswap pool configs
        bool swapViaWeth;       // whether to swap the asset to WETH before swapping to base token; applies to SushiSwap and Uniswap pool configs
        bytes32 balancerPoolId; // pool id for the asset pair; only applies to Balancer pool configs
        address curvePool;      // address of target Curve pool; only applies to Curve pool configs
    }

    /** OnChainLiquidator immutables **/

    /// @notice Balancer Vault used for token exchange
    address public immutable balancerVault;

    /// @notice SushiSwap router used for token exchange
    address public immutable sushiSwapRouter;

    /// @notice Uniswap router used for token exchange
    address public immutable uniswapRouter;

    /// @notice Lido Staked Ether 2.0 address
    address public immutable stEth;

    /// @notice Wrapped liquid staked Ether 2.0 address
    address public immutable wstEth;

    /** OnChainLiquidator configuration constants **/

    /// @notice Address used by Curve to represent null
    address public constant NULL_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @notice The scale for asset price calculations
    uint256 public constant QUOTE_PRICE_SCALE = 1e18;

    /// @notice The asset pool configurations
    mapping(address => PoolConfig) public poolConfigs;

    /**
     * @notice Construct a new liquidator instance
     * @param balancerVault_ Address of Balancer Vault
     * @param sushiSwapRouter_ Address of SushiSwap Router
     * @param uniswapRouter_ Address of Uniswap Router
     * @param uniswapV3Factory_ Address of Uniswap V3 Factory
     * @param stEth_ Address of stETH contract
     * @param wstEth_ Address of wstETH contract
     * @param WETH9_ Address of WETH9
     **/
    constructor(
        address balancerVault_,
        address sushiSwapRouter_,
        address uniswapRouter_,
        address uniswapV3Factory_,
        address stEth_,
        address wstEth_,
        address WETH9_
    ) PeripheryImmutableState(uniswapV3Factory_, WETH9_) {
        balancerVault = balancerVault_;
        sushiSwapRouter = sushiSwapRouter_;
        uniswapRouter = uniswapRouter_;
        stEth = stEth_;
        wstEth = wstEth_;
    }

    /**
     * @notice Calls the pools flash function with data needed in `uniswapV3FlashCallback`
     * @param comet Instance of Comet to liquidate from
     * @param liquidatableAccounts List of addresses where Comet.isLiquidatable(address) is true
     * @param assets List of Comet collateral assets to buy and sell
     * @param poolConfigs List of PoolConfig structs for each asset in `assets`; determines which exchange to use when swapping
     * @param maxAmountsToPurchase Max amount of each asset to attempt to buy and sell
     * @param flashLoanPairToken Address used (in combination with Comet base asset) to find the Uniswap pool to request flash loan from (e.g. USDC/DAI/500)
     * @param flashLoanPoolFee Pool fee of the Uniswap pool to request flash loan from (e.g. USDC/DAI/500)
     * @param liquidationThreshold Minimum amount (in terms of Comet base token) to attempt to buy/sell
     */
    function absorbAndArbitrage(
        address comet,
        address[] calldata liquidatableAccounts,
        address[] calldata assets,
        PoolConfig[] calldata poolConfigs,
        uint[] calldata maxAmountsToPurchase,
        address flashLoanPairToken,
        uint24 flashLoanPoolFee,
        uint liquidationThreshold
    ) external {
        if (poolConfigs.length != assets.length) revert InvalidArgument();
        if (maxAmountsToPurchase.length != assets.length) revert InvalidArgument();

        // Absorb Comet underwater accounts
        CometInterface(comet).absorb(msg.sender, liquidatableAccounts);
        emit Absorb(msg.sender, liquidatableAccounts);

        uint256 flashLoanAmount = 0;
        uint256[] memory assetBaseAmounts = new uint256[](assets.length);

        for (uint8 i = 0; i < assets.length; i++) {
            ( , uint256 collateralBalanceInBase) = purchasableBalanceOfAsset(
                comet,
                assets[i],
                maxAmountsToPurchase[i]
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
            emit Swap(asset, WETH9, swapAmount, swapAmountNew, poolConfig);
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
            revert InsufficientAmountOut(swapToken, baseToken, swapAmount, amountOut, amountOutMin, poolConfig);
        }

        emit Swap(swapToken, baseToken, swapAmount, amountOut, poolConfig);

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

        TransferHelper.safeApprove(asset, sushiSwapRouter, swapAmount);

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

        uint256[] memory amounts = IUniswapV2Router(sushiSwapRouter).swapExactTokensForTokens(
            swapAmount,     // amountIn
            0,              // amountOutMin
            path,           // path
            address(this),  // to
            block.timestamp // deadline
        );
        uint256 amountOut = amounts[amounts.length - 1];

        // we do a manual check against `amountOutMin` (instead of specifying an
        // `amountOutMinimum` in the swap) so we can provide better information
        // in the error message
        if (amountOut < amountOutMin) {
            revert InsufficientAmountOut(swapToken, baseToken, swapAmount, amountOut, amountOutMin, poolConfig);
        }

        emit Swap(swapToken, baseToken, swapAmount, amountOut, poolConfig);

        return amountOut;
    }

    function swapViaBalancer(address comet, address asset, uint256 amountOutMin, PoolConfig memory poolConfig) internal returns (uint256) {
        uint256 swapAmount = ERC20(asset).balanceOf(address(this));
        // Safety check, make sure residue balance in protocol is ignored
        if (swapAmount == 0) return 0;

        address swapToken = asset;

        address baseToken = CometInterface(comet).baseToken();

        TransferHelper.safeApprove(asset, address(balancerVault), swapAmount);

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

        int256[] memory assetDeltas = IVault(balancerVault).batchSwap(
            IVault.SwapKind.GIVEN_IN,
            steps,
            assets,
            IVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(this),
                toInternalBalance: false
            }),
            limits,
            block.timestamp
        );

        int256 signedAmountOut = -assetDeltas[assetDeltas.length - 1];

        if (signedAmountOut < 0) {
            revert InsufficientAmountOut(swapToken, baseToken, swapAmount, 0, amountOutMin, poolConfig);
        }

        uint256 amountOut = uint256(signedAmountOut);

        if (amountOut < amountOutMin) {
            revert InsufficientAmountOut(swapToken, baseToken, swapAmount, amountOut, amountOutMin, poolConfig);
        }

        emit Swap(swapToken, baseToken, swapAmount, amountOut, poolConfig);

        return amountOut;
    }

    function swapViaCurve(address comet, address asset, uint256 amountOutMin, PoolConfig memory poolConfig) internal returns (uint256) {
        uint256 swapAmount = ERC20(asset).balanceOf(address(this));
        // Safety check, make sure residue balance in protocol is ignored
        if (swapAmount == 0) return 0;

        address tokenIn = asset;

        // unwrap wstETH
        if (tokenIn == wstEth) {
            swapAmount = IWstETH(wstEth).unwrap(swapAmount);
            tokenIn = stEth;
        }

        address curvePool = poolConfig.curvePool;

        TransferHelper.safeApprove(tokenIn, address(curvePool), swapAmount);

        address coin0 = IStableSwap(curvePool).coins(0);
        address coin1 = IStableSwap(curvePool).coins(1);

        if (coin0 != tokenIn && coin1 != tokenIn) {
            revert InvalidPoolConfig(tokenIn, poolConfig);
        }

        address tokenOut = CometInterface(comet).baseToken();

        // Curve uses the null address to represent ETH
        if (coin0 == NULL_ADDRESS || coin1 == NULL_ADDRESS) {
            tokenOut = NULL_ADDRESS;
        }

        int128 idxOfTokenIn = coin0 == asset ? int128(0) : int128(1);
        int128 idxOfTokenOut = idxOfTokenIn == 0 ? int128(1) : int128(0);

        uint amountOut = IStableSwap(curvePool).exchange(
            idxOfTokenIn,  // i idx of token to send
            idxOfTokenOut, // j idx of token to receive
            swapAmount,    // _dx amount of i to be exchanged
            0              // _min_dy min amount of j to receive
        );

        if (amountOut < amountOutMin) {
            revert InsufficientAmountOut(tokenIn, tokenOut, swapAmount, amountOut, amountOutMin, poolConfig);
        }

        // wrap any received ETH to WETH
        if (tokenOut == NULL_ADDRESS) {
            IWETH9(WETH9).deposit{value: amountOut}();
            amountOut = IWETH9(WETH9).balanceOf(address(this));
            tokenOut = WETH9;
        }

        emit Swap(tokenIn, tokenOut, swapAmount, amountOut, poolConfig);

        return amountOut;
    }

    receive() external payable {}
}
