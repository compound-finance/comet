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
 * @title Compound Migrate V2 USDC to V3 USDC
 * @notice A contract to help migrate a Compound v2 position where a user is borrowing USDC, to a similar Compound v3 position.
 * @author Compound
 */
contract Compound_Migrate_V2_USDC_to_V3_USDC is IUniswapV3FlashCallback, PeripheryImmutableState, PeripheryPayments {
    /** Events **/
    event Absorb(address indexed initiator, address[] accounts);

    /// @notice The Comet Ethereum mainnet USDC contract
    CometInterface immutable comet;

    /// @notice The Uniswap pool used by this contract to source liquidity (i.e. flash loans).
    UniswapPool immutable uniswapLiquidityPool;

    /// @notice True if borrow token is token 0 in the Uniswap liquidity pool, otherwise false if token 1.
    bool immutable uniswapLiquidityPoolToken0;

    /// @notice Fee for a flash loan from the liquidity pool as a fixed decimal (e.g. `0.001e18 = 0.1%`)
    uint256 immutable uniswapLiquidityPoolFee;

    /// @notice A list of valid collateral tokens
    Erc20[] public collateralTokens;

    /// @notice The Compound II market for the borrowed token (e.g. `cUSDC`).
    CToken immutable borrowCToken; 

    /// @notice The underlying borrow token (e.g. `USDC`).
    Erc20 immutable borrowToken;

    /// @notice Address to send swept tokens to, if for any reason they remain locked in this contract.
    address immutable sweepee;

    /**
     * @notice Construct a new Compound_Migrate_V2_USDC_to_V3_USDC
     * @param comet_ The Comet Ethereum mainnet USDC contract.
     * @param uniswapLiquidityPool_ The Uniswap pool used by this contract to source liquidity (i.e. flash loans).
     * @param collateralTokens_ A list of valid collateral tokens
     * @param borrowCToken The Compound II market for the borrowed token (e.g. `cUSDC`).
     **/
    constructor(Comet comet_, CToken borrowCToken_, UniswapPool uniswapLiquidityPool_, Erc20[] collateralTokens_, address sweepee_) {
      comet = comet_;
      borrowCToken = borrowCToken_;
      borrowToken = borrowCToken_.underlying();
      uniswapLiquidityPool = uniswapLiquidityPool_;
      uniswapLiquidityPoolFee = uniswapLiquidityPool.fee();
      uniswapLiquidityPoolToken0 = uniswapLiquidityPool.token0() == borrowToken;
      sweepee = sweepee_;
      for (uint8 i = 0; i < collateralTokens_.length; i++) {
        colllateralTokens.push(collateralTokens_[i]);
      }
    }

    /**
     * @notice This is the core function of this contract, migrating a position from Compound II to Compound III. We use a flash loan from Uniswap to provide liquidity to move the position.
     * @param collateral Array of collateral to transfer into Compound III. See notes below.
     * @param borrowAmount Amount of borrow to migrate (i.e. close in Compound II, and borrow from Compound III). See notes below.
     * @dev **N.B.** Collateral requirements may be different in Compound II and Compound III. This may lead to a migration failing or being less collateralized after the migration. There are fees associated with the flash loan, which may affect position or cause migration to fail.
     * @dev Note: each `collateral` market must exist in `collateralTokens` array, defined on contract creation.
     * @dev Note: each `collateral` market must be supported in Compound III.
     * @dev Note: `collateral` amounts of 0 are strictly ignored. Collateral amounts of max uint256 are set to the user's current balance.
     * @dev Note: `borrowAmount` may be set to max uint256 to migrate the entire current borrow balance.
     **/
    function migrate(collateral: (CToken, uint256)[], borrowAmount: uint256) external {

    }

    /**
     * @notice This function handles a callback from the Uniswap Liquidity Pool after it has sent this contract the requested tokens. We are responsible for repaying those tokens, with a fee, before we return from this function call.
     * @param fee0 The fee for borrowing token0 from pool. Ingored.
     * @param fee1 The fee for borrowing token1 from pool. Ingored.
     * @param data The data encoded above, which is the ABI-encoding of XXX.
     **/
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external {

    }

    /**
     * @notice Sends any tokens in this contract to the sweepee address. This contract should never hold tokens, so this is just to fix any anomalistic situations where tokens end up locked in the contract.
     * @param token The token to sweep
     **/
    function sweep(Erc20 token) external {

    }

    // /**
    //  * @notice Uniswap flashloan callback
    //  * @param fee0 The fee for borrowing token0 from pool
    //  * @param fee1 The fee for borrowing token1 from pool
    //  * @param data The encoded data passed from loan initiation function
    //  */
    // function uniswapV3FlashCallback(
    //     uint256 fee0,
    //     uint256 fee1,
    //     bytes calldata data
    // ) external override {
    //     // Verify uniswap callback, recommended security measure
    //     FlashCallbackData memory decoded = abi.decode(data, (FlashCallbackData));
    //     CallbackValidation.verifyCallback(factory, decoded.poolKey);

    //     address[] memory assets = decoded.assets;

    //     // Allow Comet protocol to withdraw USDC (base token) for collateral purchase
    //     TransferHelper.safeApprove(comet.baseToken(), address(comet), decoded.amount);

    //     uint256 totalAmountOut = 0;
    //     for (uint i = 0; i < assets.length; i++) {
    //         address asset = assets[i];
    //         uint256 baseAmount = decoded.baseAmounts[i];

    //         if (baseAmount == 0) continue;

    //         comet.buyCollateral(asset, 0, baseAmount, address(this));
    //         uint256 amountOut = swapCollateral(asset);
    //         totalAmountOut += amountOut;
    //     }

    //     // We borrow only 1 asset, so one of fees will be 0
    //     uint256 fee = fee0 + fee1;
    //     // Payback flashloan to Uniswap pool and profit to the caller
    //     payback(decoded.amount, fee, comet.baseToken(), totalAmountOut);
    // }

    // /**
    //  * @dev Returns loan to Uniswap pool and sends USDC (base token) profit to caller
    //  * @param amount The loan amount that need to be repaid
    //  * @param fee The fee for taking the loan
    //  * @param token The base token which was borrowed for successful liquidation
    //  * @param amountOut The total amount of base token received after liquidation
    //  */
    // function payback(
    //     uint256 amount,
    //     uint256 fee,
    //     address token,
    //     uint256 amountOut
    // ) internal {
    //     uint256 amountOwed = amount + fee;
    //     TransferHelper.safeApprove(token, address(this), amountOwed);

    //     // Repay the loan
    //     if (amountOwed > 0) {
    //         pay(token, address(this), msg.sender, amountOwed);
    //         emit Pay(token, address(this), msg.sender, amountOwed);
    //     }

    //     // If profitable, pay profits to the caller
    //     if (amountOut > amountOwed) {
    //         uint256 profit = amountOut - amountOwed;
    //         TransferHelper.safeApprove(token, address(this), profit);
    //         pay(token, address(this), recipient, profit);
    //         emit Pay(token, address(this), recipient, profit);
    //     }
    // }

    // /**
    //  * @dev Calculates the total amount of base asset needed to buy all the discounted collateral from the protocol
    //  */
    // function calculateTotalBaseAmount() internal view returns (uint256, uint256[] memory, address[] memory) {
    //     uint256 totalBaseAmount = 0;
    //     uint8 numAssets = comet.numAssets();
    //     uint256[] memory assetBaseAmounts = new uint256[](numAssets);
    //     address[] memory cometAssets = new address[](numAssets);
    //     for (uint8 i = 0; i < numAssets; i++) {
    //         address asset = comet.getAssetInfo(i).asset;
    //         cometAssets[i] = asset;
    //         uint256 collateralBalance = comet.collateralBalanceOf(address(comet), asset);

    //         if (collateralBalance == 0) continue;

    //         // Find the price in asset needed to base QUOTE_PRICE_SCALE of USDC (base token) of collateral
    //         uint256 quotePrice = comet.quoteCollateral(asset, QUOTE_PRICE_SCALE * comet.baseScale());
    //         uint256 assetBaseAmount = comet.baseScale() * QUOTE_PRICE_SCALE * collateralBalance / quotePrice;

    //         // Liquidate only positions with adequate size, no need to collect residue from protocol
    //         if (assetBaseAmount < liquidationThreshold) continue;

    //         assetBaseAmounts[i] = assetBaseAmount;
    //         totalBaseAmount += assetBaseAmount;
    //     }

    //     return (totalBaseAmount, assetBaseAmounts, cometAssets);
    // }

    // /**
    //  * @notice Calls the pools flash function with data needed in `uniswapV3FlashCallback`
    //  * @param params The parameters necessary for flash and the callback, passed in as FlashParams
    //  */
    // function initFlash(FlashParams memory params) external {
    //     // Absorb Comet underwater accounts
    //     comet.absorb(address(this), params.accounts);
    //     emit Absorb(msg.sender, params.accounts);

    //     (uint256 totalBaseAmount, uint256[] memory assetBaseAmounts, address[] memory cometAssets) = calculateTotalBaseAmount();

    //     address poolToken0 = params.pairToken;
    //     address poolToken1 = comet.baseToken();
    //     bool reversedPair = poolToken0 > poolToken1;
    //     // Use Uniswap approach to determining order of tokens https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol#L20-L27
    //     if (reversedPair) (poolToken0, poolToken1) = (poolToken1, poolToken0);

    //     // Find the desired Uniswap pool to borrow base token from, for ex DAI-USDC
    //     PoolAddress.PoolKey memory poolKey =
    //         PoolAddress.PoolKey({token0: poolToken0, token1: poolToken1, fee: params.poolFee});
    //     IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress.computeAddress(factory, poolKey));

    //     // recipient of borrowed amounts
    //     // amount of token0 requested to borrow, 0 for non reversed pair
    //     // amount of token1 requested to borrow, 0 for reversed pair
    //     // need amount in callback to pay back pool
    //     // need assets addresses to buy collateral from protocol
    //     // need baseAmounts to buy collateral from protocol
    //     // recipient of flash should be THIS contract
    //     pool.flash(
    //         address(this),
    //         reversedPair ? totalBaseAmount : 0,
    //         reversedPair ? 0 : totalBaseAmount,
    //         abi.encode(
    //             FlashCallbackData({
    //                 amount: totalBaseAmount,
    //                 recipient: msg.sender,
    //                 poolKey: poolKey,
    //                 assets: cometAssets,
    //                 baseAmounts: assetBaseAmounts
    //             })
    //         )
    //     );
    // }
}
