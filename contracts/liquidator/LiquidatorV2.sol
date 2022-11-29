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
import "hardhat/console.sol";

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

    /// @notice The scale for asset price calculations
    uint256 public constant QUOTE_PRICE_SCALE = 1e18;

    constructor(
        CometInterface _comet,
        address _factory,
        address _WETH9
    ) PeripheryImmutableState(_factory, _WETH9) {
        comet = _comet;
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
        uint256[] calldata assetBaseAmounts,
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

        uint flashLoanAmount = 0;
        for (uint8 i = 0; i < assetBaseAmounts.length; i++) {
            flashLoanAmount += assetBaseAmounts[i];
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
        console.log("uniswapV3FlashCallback");

    }
}
