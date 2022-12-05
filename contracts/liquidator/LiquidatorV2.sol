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

/* DELETE */
// import "hardhat/console.sol";
import "forge-std/console.sol";

/**
 * @title XXX
 * @notice XXX
 * @author Compound
 */
contract LiquidatorV2 is IUniswapV3FlashCallback, PeripheryImmutableState, PeripheryPayments {
    /** Errors */
    error InsufficientBalance(uint256 available, uint256 required);
    error Unauthorized();

    /** Events **/
    event Absorb(address indexed initiator, address[] accounts);
    event AbsorbWithoutBuyingCollateral();
    event Pay(address indexed token, address indexed payer, address indexed recipient, uint256 value);
    // event Swap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, Exchange exchange, uint24 fee);

    /// @notice Compound Comet protocol
    CometInterface public immutable comet;

    /// @notice Address to send liquidation proceeds to
    address public immutable recipient;

    /// @notice The scale for asset price calculations
    uint256 public constant QUOTE_PRICE_SCALE = 1e18;

    constructor(
        CometInterface _comet,
        address _factory,
        address _WETH9,
        address _recipient
    ) PeripheryImmutableState(_factory, _WETH9) {
        comet = _comet;
        recipient = _recipient;
    }

    function balanceOfAsset(address asset) internal returns (uint256, uint256) {
        uint256 collateralBalance = comet.getCollateralReserves(asset);

        console.log("balanceOfAsset asset: %s", asset);
        console.log("balanceOfAsset collateralBalance: %s", collateralBalance);

        uint256 baseScale = comet.baseScale();

        uint256 quotePrice = comet.quoteCollateral(asset, QUOTE_PRICE_SCALE * baseScale);
        uint256 collateralBalanceInBase = baseScale * QUOTE_PRICE_SCALE * collateralBalance / quotePrice;

        return (
            collateralBalance,
            collateralBalanceInBase
        );
    }

    /**
     * @notice XXX
     * @dev for use with static call
     */
    function availableCollateral(
        address[] calldata liquidatableAccounts
    ) external returns (address[] memory, uint256[] memory, uint256[] memory) {
        comet.absorb(address(this), liquidatableAccounts);

        uint8 numAssets = comet.numAssets();

        address[] memory assets = new address[](numAssets);
        uint256[] memory collateralReserves = new uint256[](numAssets);
        uint256[] memory collateralReservesInBase = new uint256[](numAssets);

        for (uint8 i = 0; i < numAssets; i++) {
            address asset = comet.getAssetInfo(i).asset;
            assets[i] = asset;
            uint256 collateralBalance = comet.getCollateralReserves(asset);

            console.log("availableCollateral asset: %s", asset);
            console.log("availableCollateral collateralBalance: %s", collateralBalance);
            // reduce by 5%?
            collateralReserves[i] = collateralBalance;

            uint256 baseScale = comet.baseScale();

            uint256 quotePrice = comet.quoteCollateral(asset, QUOTE_PRICE_SCALE * baseScale);
            collateralReservesInBase[i] = baseScale * QUOTE_PRICE_SCALE * collateralBalance / quotePrice;
        }

        return (
            assets,
            collateralReserves,
            collateralReservesInBase
        );
    }

    // XXX move
    struct FlashCallbackData {
        uint256 flashLoanAmount;
        PoolAddress.PoolKey poolKey;
        address[] assets;
        uint256[] assetBaseAmounts;

        address[] swapTargets;
        bytes[] swapTransactions;
    }

    // XXX name?
    function absorbAndArbitrage(
        address[] calldata liquidatableAccounts,
        address[] calldata assets,
        // uint256[] calldata assetBaseAmounts,
        address[] calldata swapTargets,
        bytes[] calldata swapTransactions
    ) external {
        comet.absorb(address(this), liquidatableAccounts);
        emit Absorb(msg.sender, liquidatableAccounts);

        address poolToken0 = 0x6B175474E89094C44Da98b954EedeAC495271d0F; // XXX DAI
        address poolToken1 = comet.baseToken();
        bool reversedPair = poolToken0 > poolToken1;
        // Use Uniswap approach to determining order of tokens https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol#L20-L27
        if (reversedPair) (poolToken0, poolToken1) = (poolToken1, poolToken0);

        // Find the desired Uniswap pool to borrow base token from, for ex DAI-USDC
        // XXX can probably store this poolKey
        PoolAddress.PoolKey memory poolKey = PoolAddress.PoolKey({
            token0: poolToken0,
            token1: poolToken1,
            fee: 100 // XXX
        });

        IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress.computeAddress(factory, poolKey));

        uint256 flashLoanAmount = 0;
        uint256[] memory assetBaseAmounts = new uint256[](assets.length);
        for (uint8 i = 0; i < assets.length; i++) {
            (
                uint256 _collateralBalance,
                uint256 collateralBalanceInBase
            ) = balanceOfAsset(assets[i]);
            flashLoanAmount += collateralBalanceInBase;
            assetBaseAmounts[i] = collateralBalanceInBase;
        }

        pool.flash(
            address(this),
            reversedPair ? flashLoanAmount : 0,
            reversedPair ? 0 : flashLoanAmount,
            abi.encode(
                FlashCallbackData({
                    flashLoanAmount: flashLoanAmount,
                    poolKey: poolKey,
                    assets: assets,
                    assetBaseAmounts: assetBaseAmounts,
                    swapTargets: swapTargets,
                    swapTransactions: swapTransactions
                })
            )
        );
    }

    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        // console.log("uniswapV3FlashCallback");

        FlashCallbackData memory flashCallbackData = abi.decode(data, (FlashCallbackData));
        CallbackValidation.verifyCallback(factory, flashCallbackData.poolKey);

        TransferHelper.safeApprove(comet.baseToken(), address(comet), flashCallbackData.flashLoanAmount);

        uint256 totalAmountOut = 0;
        for (uint i = 0; i < flashCallbackData.assets.length; i++) {
            address asset = flashCallbackData.assets[i];
            uint256 assetBaseAmount = flashCallbackData.assetBaseAmounts[i];

            console.log("asset: %s", asset);
            console.log("assetBaseAmount: %s", assetBaseAmount);

            comet.buyCollateral(asset, 0, assetBaseAmount, address(this));

            uint256 swapAmount = ERC20(asset).balanceOf(address(this));

            console.log("address(this) balance of asset: %s", swapAmount);

            // console.log(flashCallbackData.swapTargets[i]);
            // console.logBytes(flashCallbackData.swapTransactions[i]);

            TransferHelper.safeApprove(asset, address(flashCallbackData.swapTargets[i]), type(uint256).max);

            (bool success, bytes memory returnData) = flashCallbackData.swapTargets[i].call(flashCallbackData.swapTransactions[i]);

            assembly {
                if eq(success, 0) {
                    revert(add(returnData, 0x20), returndatasize())
                }
            }

            (uint256 amountOut) = abi.decode(returnData, (uint256));

            console.log("amountOut (in base token): %s", amountOut);

            // require(success, "SWAP_CALL_FAILED");
            // console.log("returnAmount: %s", returnAmount);
            // uint256 amountOut = swapCollateral(asset, baseAmount);
            totalAmountOut += amountOut;
        }

        console.log("totalAmountOut: %s", totalAmountOut);

        address baseToken = comet.baseToken();

        uint256 totalAmountOwed = flashCallbackData.flashLoanAmount + fee0 + fee1;
        uint256 balance = ERC20(baseToken).balanceOf(address(this));

        console.log("balance of base token (after swaps): %s", balance);

        console.log("flashCallbackData.flashLoanAmount: %s", flashCallbackData.flashLoanAmount);
        console.log("fee0: %s", fee0);
        console.log("fee1: %s", fee1);
        console.log("totalAmountOwed: %s", totalAmountOwed);

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

        console.log("remainingBalance: %s", remainingBalance);

        // If profitable, pay profits to the caller
        if (remainingBalance > 0) {
            // uint256 profit = amountOut - amountOwed;
            TransferHelper.safeApprove(baseToken, address(this), remainingBalance);
            pay(baseToken, address(this), recipient, remainingBalance);
            emit Pay(baseToken, address(this), recipient, remainingBalance);
        }


    }
}
