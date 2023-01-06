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

/**
 * @title Liquidator contract compatible with 1inch DEX aggregator
 * @author Compound
 */
contract LiquidatorV2 is IUniswapV3FlashCallback, PeripheryImmutableState, PeripheryPayments {
    /** Errors */
    error InsufficientBalance(uint256 available, uint256 required);
    error Unauthorized();

    /** Events **/
    event Absorb(address indexed initiator, address[] accounts);
    event Pay(address indexed token, address indexed payer, address indexed recipient, uint256 value);
    event BuyAndSwap(address indexed tokenIn, address indexed tokenOut, uint256 baseAmountPaid, uint256 assetBalance, uint256 amountOut);

    /// @notice The admin address
    address public immutable admin;

    /// @notice Address to send liquidation proceeds to
    address public immutable recipient;

    /// @notice The scale for asset price calculations
    uint256 public constant QUOTE_PRICE_SCALE = 1e18;

    struct AssetConfig {
        uint256 maxCollateralToPurchase;
        bool isSet;
    }

    /// @notice mapping of comet instance => assets => asset config
    mapping(address => mapping(address => AssetConfig)) public assetConfigs;

    // XXX natspecs
    constructor(
        address _factory,
        address _WETH9,
        address _recipient
    ) PeripheryImmutableState(_factory, _WETH9) {
        admin = msg.sender;
        recipient = _recipient;
    }

    /**
     * @notice Set new value for asset config
     * @param asset The asset to set new config for
     * @param maxCollateralToPurchase max amount (in units of the asset) to purchase when swapping
     * @param isSet flag for whether to use the maxCollateralToPurchase amount;
     * set to false to allow for uncapped purchases
     */
    function setAssetConfig(address comet, address asset, uint256 maxCollateralToPurchase, bool isSet) external {
        if (msg.sender != admin) revert Unauthorized();

        assetConfigs[comet][asset] = AssetConfig({
            maxCollateralToPurchase: maxCollateralToPurchase,
            isSet: isSet
        });
    }

    /**
     * @dev Returns lesser of two values
     */
    function min(uint256 a, uint256 b) internal view returns (uint256) {
        return a <= b ? a : b;
    }

    function purchasableBalanceOfAsset(address comet, address asset) internal returns (uint256, uint256) {
        uint256 collateralBalance = CometInterface(comet).getCollateralReserves(asset);

        AssetConfig memory assetConfig = assetConfigs[comet][asset];
        if (assetConfig.isSet) {
            collateralBalance = min(collateralBalance, assetConfig.maxCollateralToPurchase);
        }

        uint256 baseScale = CometInterface(comet).baseScale();

        uint256 quotePrice = CometInterface(comet).quoteCollateral(asset, QUOTE_PRICE_SCALE * baseScale);
        uint256 collateralBalanceInBase = baseScale * QUOTE_PRICE_SCALE * collateralBalance / quotePrice;

        uint256 actualCollateralAmountOut = CometInterface(comet).quoteCollateral(asset, collateralBalanceInBase);

        return (
            actualCollateralAmountOut,
            collateralBalanceInBase
        );
    }

    /**
     * @notice Return the amount of each asset available to purchase (and how
     * much base token it will cost to purchase it all) after absorbing a list
     * of accounts
     * @dev intended for use as a static call
     */
    function availableCollateral(
        address comet,
        address[] calldata liquidatableAccounts
    ) external returns (address[] memory, uint256[] memory, uint256[] memory) {
        CometInterface(comet).absorb(address(this), liquidatableAccounts);

        uint8 numAssets = CometInterface(comet).numAssets();

        address[] memory assets = new address[](numAssets);
        uint256[] memory collateralReserves = new uint256[](numAssets);
        uint256[] memory collateralReservesInBase = new uint256[](numAssets);

        for (uint8 i = 0; i < numAssets; i++) {
            address asset = CometInterface(comet).getAssetInfo(i).asset;
            assets[i] = asset;
            (uint256 collateralBalance, uint256 collateralBalanceInBase) = purchasableBalanceOfAsset(comet, asset);

            collateralReserves[i] = collateralBalance;
            collateralReservesInBase[i] = collateralBalanceInBase;
        }

        return (
            assets,
            collateralReserves,
            collateralReservesInBase
        );
    }

    /**
     * @notice Absorb a set of liquidatable accounts and then buy and sell the
     * available collateral
     * @param comet Address of Comet instance
     * @param liquidatableAccounts A list of accounts to absorb
     * @param assets The assets to buy and sell
     * @param swapTargets Addresses of the swap router to use (generated via
     * 1inch API)
     * @param swapTransactions Call data of the swap transactions to use
     * (generated via 1inch API)
     * @param flashLoanPairToken Token to pair with base token for flash swap pool (e.g. DAI/USDC/100)
     * @param flashLoanPoolFee Fee for flash swap pool (e.g. DAI/USDC/100)
     */
    function absorbAndArbitrage(
        address comet,
        address[] calldata liquidatableAccounts,
        address[] calldata assets,
        address[] calldata swapTargets,
        bytes[] calldata swapTransactions,
        address flashLoanPairToken,
        uint24 flashLoanPoolFee
    ) external {
        CometInterface(comet).absorb(address(this), liquidatableAccounts);
        emit Absorb(msg.sender, liquidatableAccounts);

        address poolToken0 = flashLoanPairToken;
        address poolToken1 = CometInterface(comet).baseToken();
        bool reversedPair = poolToken0 > poolToken1;
        // Use Uniswap approach to determining order of tokens https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol#L20-L27
        if (reversedPair) (poolToken0, poolToken1) = (poolToken1, poolToken0);

        // Find the desired Uniswap pool to borrow base token from, for ex DAI-USDC
        PoolAddress.PoolKey memory poolKey = PoolAddress.PoolKey({
            token0: poolToken0,
            token1: poolToken1,
            fee: flashLoanPoolFee
        });

        IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress.computeAddress(factory, poolKey));

        uint256 flashLoanAmount = 0;
        uint256[] memory assetBaseAmounts = new uint256[](assets.length);
        for (uint8 i = 0; i < assets.length; i++) {
            ( , uint256 collateralBalanceInBase) = purchasableBalanceOfAsset(comet, assets[i]);
            flashLoanAmount += collateralBalanceInBase;
            assetBaseAmounts[i] = collateralBalanceInBase;
        }

        pool.flash(
            address(this),
            reversedPair ? flashLoanAmount : 0,
            reversedPair ? 0 : flashLoanAmount,
            abi.encode(
                FlashCallbackData({
                    comet: comet,
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

    struct FlashCallbackData {
        address comet;
        uint256 flashLoanAmount;
        PoolAddress.PoolKey poolKey;
        address[] assets;
        uint256[] assetBaseAmounts;
        address[] swapTargets;
        bytes[] swapTransactions;
    }

    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        FlashCallbackData memory flashCallbackData = abi.decode(data, (FlashCallbackData));
        CallbackValidation.verifyCallback(factory, flashCallbackData.poolKey);

        TransferHelper.safeApprove(CometInterface(flashCallbackData.comet).baseToken(), address(flashCallbackData.comet), flashCallbackData.flashLoanAmount);

        address baseToken = CometInterface(flashCallbackData.comet).baseToken();

        uint256 totalAmountOut = 0;

        for (uint i = 0; i < flashCallbackData.assets.length; i++) {
            address asset = flashCallbackData.assets[i];
            uint256 assetBaseAmount = flashCallbackData.assetBaseAmounts[i];

            CometInterface(flashCallbackData.comet).buyCollateral(asset, 0, assetBaseAmount, address(this));

            uint256 assetBalance = ERC20(asset).balanceOf(address(this));

            TransferHelper.safeApprove(asset, address(flashCallbackData.swapTargets[i]), type(uint256).max);

            (bool success, bytes memory returnData) = flashCallbackData.swapTargets[i].call(flashCallbackData.swapTransactions[i]);

            // XXX review
            assembly {
                if eq(success, 0) {
                    revert(add(returnData, 0x20), returndatasize())
                }
            }

            (uint256 amountOut) = abi.decode(returnData, (uint256));

            emit BuyAndSwap(asset, baseToken, assetBaseAmount, assetBalance, amountOut);

            totalAmountOut += amountOut;
        }

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

        // If profitable, pay profits to the caller
        if (remainingBalance > 0) {
            TransferHelper.safeApprove(baseToken, address(this), remainingBalance);
            pay(baseToken, address(this), recipient, remainingBalance);
            emit Pay(baseToken, address(this), recipient, remainingBalance);
        }
    }
}
