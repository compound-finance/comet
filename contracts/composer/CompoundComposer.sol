// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

/// Minimal composer that bundles two Compound calls in one EVM tx.
/// Strictly thinner than BaseBulker.invoke — no `bytes32 action` switch,
/// no `bytes calldata data` per-action abi.decode, no native-token paths.
/// Goal: measure how much CU the Bulker dispatch overhead actually costs
/// on Rome's EVM lane, by comparing this against bulker.invoke([...]).
///
/// Caller (the user) must have:
///   - comet.allow(address(this), true)              [granted as Compound manager]
///   - collateralAsset.approve(comet, ...)           [for pull at supplyFrom step]
/// Caller does NOT need to approve this contract directly — Compound's
/// doTransferIn pulls from the user, with comet as msg.sender for the
/// transferFrom; this contract is only the manager invoking supplyFrom.

interface IComet {
    function supplyFrom(address from, address dst, address asset, uint256 amount) external;
    function withdrawFrom(address src, address to, address asset, uint256 amount) external;
}

contract CompoundComposer {
    /// Open-leverage compose: supply collateral + borrow base, both
    /// crediting/debiting msg.sender's Compound position.
    function supplyCollateralAndBorrow(
        address comet,
        address collateralAsset,
        uint256 collateralAmount,
        address baseAsset,
        uint256 borrowAmount
    ) external {
        IComet(comet).supplyFrom(msg.sender, msg.sender, collateralAsset, collateralAmount);
        IComet(comet).withdrawFrom(msg.sender, msg.sender, baseAsset, borrowAmount);
    }

    /// Close-leverage compose: repay base + withdraw collateral. Symmetric
    /// to supplyCollateralAndBorrow.
    function repayAndWithdrawCollateral(
        address comet,
        address baseAsset,
        uint256 repayAmount,
        address collateralAsset,
        uint256 withdrawAmount
    ) external {
        IComet(comet).supplyFrom(msg.sender, msg.sender, baseAsset, repayAmount);
        IComet(comet).withdrawFrom(msg.sender, msg.sender, collateralAsset, withdrawAmount);
    }
}
