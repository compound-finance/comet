// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometInterface.sol";
import "./IERC20NonStandard.sol";

/**
 * @title LiquidationRouter
 * @notice Atomic absorb + N×buyCollateral router for Compound v3 on Rome.
 *
 * Compound v3 splits liquidation into two protocol calls (`absorb` + per-
 * asset `buyCollateral`).  A liquidator that wants to sweep an underwater
 * account and extract collateral value in one atomic operation needs both
 * to land together — otherwise a competing keeper can `buyCollateral`
 * first and steal the discount margin.
 *
 * This router exposes one entrypoint that does both legs in a single EVM
 * tx.  On Solana, that's one Solana tx — atomic by Solana runtime.  When
 * the combined CU exceeds the 1.4M atomic ceiling, the same router calls
 * stack as separate inner txs in a Jito bundle (atomic-at-slot semantics).
 *
 * Bench + decision rule: rome-specs#93.
 */
contract LiquidationRouter {
    CometInterface public immutable comet;

    error LengthMismatch();

    constructor(address _comet) {
        comet = CometInterface(_comet);
    }

    /**
     * @notice Absorb `borrower` and buy `assets[i]` for `baseAmounts[i]`
     *         from the protocol in one atomic call.
     *
     * Requirements:
     *  - `borrower` must be undercollateralized at call time (Comet checks)
     *  - msg.sender must hold + have approved this router (or the Comet)
     *    for sum(baseAmounts) of the base asset
     *  - `assets.length == minAmounts.length == baseAmounts.length`
     *
     * Per-asset minAmounts are slippage guards; baseAmounts are base spent
     * per buyCollateral leg.  All collateral and any leftover base flows
     * to `msg.sender`.
     */
    function absorbAndBuyMulti(
        address borrower,
        address[] calldata assets,
        uint256[] calldata minAmounts,
        uint256[] calldata baseAmounts
    ) external {
        if (assets.length != minAmounts.length || assets.length != baseAmounts.length) {
            revert LengthMismatch();
        }

        // Pull total base from liquidator + approve Comet to spend it.
        // Comet.buyCollateral does `doTransferIn(baseToken, msg.sender, ...)`
        // where msg.sender is this router — so the router must hold the
        // base + grant Comet allowance before each leg.
        uint256 total;
        unchecked {
            for (uint256 i = 0; i < baseAmounts.length; ++i) {
                total += baseAmounts[i];
            }
        }
        address baseToken = comet.baseToken();
        IERC20NonStandard(baseToken).transferFrom(msg.sender, address(this), total);
        IERC20NonStandard(baseToken).approve(address(comet), total);

        address[] memory accounts = new address[](1);
        accounts[0] = borrower;
        comet.absorb(msg.sender, accounts);

        for (uint256 i = 0; i < assets.length; ) {
            comet.buyCollateral(assets[i], minAmounts[i], baseAmounts[i], msg.sender);
            unchecked { ++i; }
        }
    }
}
