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

import "../CometInterface.sol";
import "../ERC20.sol";

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

    uint256 public constant QUOTE_PRICE_SCALE = 1e6;

    ISwapRouter public immutable swapRouter;
    CometInterface public immutable comet;
    address public immutable weth;

    uint24 public constant defaultPoolFee = 500;
    mapping(address => uint24) public poolFees;
    mapping(address => bool) public isLowLiquidity;

    constructor(
        ISwapRouter _swapRouter,
        CometInterface _comet,
        address _factory,
        address _WETH9,
        address[] memory _assets,
        uint24[] memory _poolFees,
        bool[] memory _lowLiquidity
    ) PeripheryImmutableState(_factory, _WETH9) {
        require(_assets.length == _poolFees.length, "Wrong input");
        require(_assets.length == _lowLiquidity.length, "Wrong input");

        swapRouter = _swapRouter;
        comet = _comet;
        weth = _WETH9;

        // Set the desirable pool fees for assets
        for (uint i = 0; i < _assets.length; i++) {
            address asset = _assets[i];
            uint24 poolFee = _poolFees[i];
            poolFees[asset] = poolFee;
            isLowLiquidity[asset] = _lowLiquidity[i];
        }
    }

    function getPoolFee(address asset) internal view returns(uint24) {
        uint24 poolFee = poolFees[asset];
        return poolFee == 0 ? defaultPoolFee : poolFee;
    }

    function swapCollateral(address asset) internal returns (uint256) {
        uint256 swapAmount = ERC20(asset).balanceOf(address(this));
        uint24 poolFee = getPoolFee(asset);
        address swapToken = asset;

        TransferHelper.safeApprove(asset, address(swapRouter), swapAmount);
        if (isLowLiquidity[asset]) {
            swapAmount = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: asset,
                    tokenOut: weth,
                    fee: poolFee,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: swapAmount,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
            swapToken = weth;
            poolFee = getPoolFee(weth);

            TransferHelper.safeApprove(weth, address(swapRouter), swapAmount);
        }

        uint256 amountOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: swapToken,
                tokenOut: comet.baseToken(),
                fee: poolFee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: swapAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        return amountOut;
    }

    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        FlashCallbackData memory decoded = abi.decode(data, (FlashCallbackData));
        CallbackValidation.verifyCallback(factory, decoded.poolKey);

        address[] memory assets = decoded.assets;

        uint256 totalAmountOut = 0;
        for (uint i = 0; i < assets.length; i++) {
            address asset = assets[i];
            uint256 baseAmount = decoded.baseAmounts[i];

            if (baseAmount == 0) continue;

            // XXX approve everything all at once?
            TransferHelper.safeApprove(comet.baseToken(), address(comet), baseAmount);

            uint24 poolFee = getPoolFee(asset);

            // XXX Replace 0 with more meaningful value here
            // XXX if buyCollateral returns collateral amount after change in Comet, no need to check balance
            comet.buyCollateral(asset, 0, baseAmount, address(this));
            uint256 collateralAmount = ERC20(asset).balanceOf(address(this));

            TransferHelper.safeApprove(asset, address(swapRouter), collateralAmount);

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
            totalAmountOut += amountOut;
        }

        uint256 fee = decoded.reversedPair? fee0 : fee1;
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

    function calculateTotalBaseAmount() internal view returns (uint256, uint256[] memory, address[] memory) {
        uint256 totalBaseAmount = 0;
        uint8 numAssets = comet.numAssets();
        uint256[] memory assetBaseAmounts = new uint256[](numAssets);
        address[] memory cometAssets = new address[](numAssets);
        for (uint8 i = 0; i < numAssets; i++) {
            address asset = comet.getAssetInfo(i).asset;
            cometAssets[i] = asset;
            uint256 collateralBalance = comet.collateralBalanceOf(address(comet), asset);

            if (collateralBalance == 0) continue;

            uint256 quotePrice = comet.quoteCollateral(asset, QUOTE_PRICE_SCALE * comet.baseScale());
            uint256 assetBaseAmount = comet.baseScale() * QUOTE_PRICE_SCALE * collateralBalance / quotePrice;
            /*
                quoteCollateral = amount of asset you get for 1 USDC
                collateralBalance = Comet's balance of asset
                price = amount of USDC required to buy the whole asset

                1 / quotePrice = x / collateralBalance
                (1 / quotePrice) * collateralBalance = x
            */
            assetBaseAmounts[i] = assetBaseAmount;
            totalBaseAmount += assetBaseAmount;
        }

        return (totalBaseAmount, assetBaseAmounts, cometAssets);
    }

    /// @param params The parameters necessary for flash and the callback, passed in as FlashParams
    /// @notice Calls the pools flash function with data needed in `uniswapV3FlashCallback`
    function initFlash(FlashParams memory params) external {
        // Absorb Comet underwater accounts
        comet.absorb(address(this), params.accounts);

        (uint256 totalBaseAmount, uint256[] memory assetBaseAmounts, address[] memory cometAssets) = calculateTotalBaseAmount();

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
            params.reversedPair ? totalBaseAmount : 0,
            params.reversedPair ? 0 : totalBaseAmount,
            abi.encode(
                FlashCallbackData({
                    amount: totalBaseAmount,
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
