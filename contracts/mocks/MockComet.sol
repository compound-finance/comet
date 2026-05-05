// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

/// @title MockComet
/// @notice Test stand-in for Compound v3 Comet. Used by `OrchestratorRouter`
/// unit tests to verify the router's `supplyTo` invocation shape without
/// pulling Comet's full dependency graph.
///
/// State observed:
///   - `lastSupplyTo` records the most recent `supplyTo(dst, asset, amount)` call.
///   - `baseToken` returns the configured base.
contract MockComet {
    address public baseToken;

    struct SupplyToCall {
        address caller;     // msg.sender
        address dst;
        address asset;
        uint256 amount;
    }
    SupplyToCall public lastSupplyTo;
    uint256 public supplyToCount;

    constructor(address baseToken_) {
        baseToken = baseToken_;
    }

    function supplyTo(address dst, address asset, uint256 amount) external {
        lastSupplyTo = SupplyToCall({
            caller: msg.sender,
            dst: dst,
            asset: asset,
            amount: amount
        });
        supplyToCount += 1;
    }
}
