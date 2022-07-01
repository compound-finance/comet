//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.15;
pragma abicoder v2;

import "./vendor/@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol";
import "./vendor/@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol";
import "./vendor/@uniswap/v3-periphery/contracts/base/PeripheryPayments.sol";
import "./vendor/@uniswap/v3-periphery/contracts/base/PeripheryImmutableState.sol";
import "./vendor/@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";
import "./vendor/@uniswap/v3-periphery/contracts/libraries/CallbackValidation.sol";
import "./vendor/@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./vendor/@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "./CometInterface.sol";
import "./ERC20.sol";

import "hardhat/console.sol";

contract Liquidator is IUniswapV3FlashCallback, PeripheryImmutableState, PeripheryPayments {
    struct FlashParams {
        address[] accounts;
        address pairToken;
        uint24 poolFee;
        bool reversedPair;
    }

    struct FlashCallbackData {
        uint256 amount;
        address payer;
        PoolAddress.PoolKey poolKey;
        address[] assets;
        uint256[] baseAmounts;
        bool reversedPair;
    }

    using LowGasSafeMath for uint256;
    using LowGasSafeMath for int256;

    ISwapRouter public immutable swapRouter;
    CometInterface public immutable comet;

    constructor(
        ISwapRouter _swapRouter,
        CometInterface _comet,
        address _factory,
        address _WETH9
    ) PeripheryImmutableState(_factory, _WETH9) {
        swapRouter = _swapRouter;
        comet = _comet;
    }

    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        console.log("Inside flashback");
        FlashCallbackData memory decoded = abi.decode(data, (FlashCallbackData));

        console.log("decoded:");
        console.log(decoded.amount);

        console.log(0);

        CallbackValidation.verifyCallback(factory, decoded.poolKey);

        console.log(1);

        address[] memory assets = decoded.assets;

        console.log(2);

        uint256 totalAmountOut = 0;
        for (uint i = 0; i < assets.length; i++) {
            console.log(3);
            address asset = assets[i];
            uint256 baseAmount = decoded.baseAmounts[i];
            console.log("baseAmount: %s", baseAmount);

            console.log("3.1");
            // XXX Figure out fee for all asset pools
            uint24 poolFee = 500;

            console.log("3.2");
            uint256 assetBalanceBefore = ERC20(asset).balanceOf(address(this));
            console.log("3.3");
            comet.buyCollateral(asset, 0, baseAmount, address(this));
            console.log("3.4");
            uint256 assetBalanceAfter = ERC20(asset).balanceOf(address(this));
            console.log("3.5");
            uint256 collateralAmount = assetBalanceAfter - assetBalanceBefore;
            console.log("3.6");
            uint256 amountOut =
                swapRouter.exactInputSingle(
                    ISwapRouter.ExactInputSingleParams({
                        tokenIn: asset,
                        tokenOut: comet.baseToken(),
                        fee: poolFee,
                        recipient: address(this),
                        deadline: block.timestamp,
                        amountIn: collateralAmount,
                        // XXX is baseAmount a good value to pass here?
                        amountOutMinimum: baseAmount,
                        sqrtPriceLimitX96: 0
                    })
                );
            console.log("3.7");
            totalAmountOut += amountOut;
        }
        console.log(4);

        uint256 fee = decoded.reversedPair? fee0 : fee1;

        console.log(5);

        payback(decoded.amount, fee, comet.baseToken(), totalAmountOut, decoded.payer);
    }

    function payback(
        uint256 amount,
        uint256 fee,
        address token,
        uint256 amountOut,
        address payer
    ) internal {
        uint256 amountOwed = LowGasSafeMath.add(amount, fee);

        TransferHelper.safeApprove(token, address(this), amountOwed);

        if (amountOwed > 0) pay(token, address(this), msg.sender, amountOwed);

        // if profitable, pay profits to payer
        if (amountOut > amountOwed) {
            uint256 profit = LowGasSafeMath.sub(amountOut, amountOwed);

            TransferHelper.safeApprove(token, address(this), profit);
            pay(token, address(this), payer, profit);
        }
    }

    /// @param params The parameters necessary for flash and the callback, passed in as FlashParams
    /// @notice Calls the pools flash function with data needed in `uniswapV3FlashCallback`
    function initFlash(FlashParams memory params) external {
        // Absorb Comet underwater accounts
        comet.absorb(address(this), params.accounts);


        uint256 baseAmount = 0;
        uint8 numAssets = comet.numAssets();
        uint256[] memory assetBaseAmounts = new uint256[](numAssets);
        address[] memory cometAssets = new address[](numAssets);
        for (uint8 i = 0; i < numAssets; i++) {
            address asset = comet.getAssetInfo(i).asset;
            console.log("asset: %s", asset);
            cometAssets[i] = asset;
            uint256 quotePrice = comet.quoteCollateral(asset, 1 * comet.baseScale());
            console.log("quotePrice: %s", quotePrice);
            uint256 collateralBalance = comet.collateralBalanceOf(address(comet), asset);
            console.log("collateralBalance: %s", collateralBalance);
            // XXX this calculation is probably incorrect
            uint256 assetBaseAmount = comet.collateralBalanceOf(address(comet), asset) * quotePrice;
            console.log("assetBaseAmount: %s", assetBaseAmount);
            assetBaseAmounts[i] = assetBaseAmount;
            baseAmount += assetBaseAmount;
        }


        address poolToken0 = params.reversedPair ? comet.baseToken(): params.pairToken;
        address poolToken1 = params.reversedPair ? params.pairToken : comet.baseToken();

        PoolAddress.PoolKey memory poolKey =
            PoolAddress.PoolKey({token0: poolToken0, token1: poolToken1, fee: params.poolFee});
        IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress.computeAddress(factory, poolKey));

        // recipient of borrowed amounts
        // amount of token0 requested to borrow, 0 for non reversed pair
        // amount of token1 requested to borrow, 0 for reversed pair
        // need amount in callback to pay back pool
        // need assets addresses to buy collateral from protocol
        // need baseAmounts to buy collateral from protocol
        // recipient of flash should be THIS contract
        pool.flash(
            address(this),
            10,
            10,
            abi.encode(
                FlashCallbackData({
                    amount: 5000000,
                    payer: msg.sender,
                    poolKey: poolKey,
                    assets: cometAssets,
                    baseAmounts: assetBaseAmounts,
                    reversedPair: params.reversedPair
                })
            )
        );
    }
}
