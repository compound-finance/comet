// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

/// @notice The router needs only `snapshotAta` + `mintId` from the full
/// UnifiedToken interface. Keeping a minimal interface decouples the router's
/// compilation from the full `ICrossVMAsset.sol` surface, which makes the
/// router reusable across protocol-layer wrappers (Morpho's USDS, RWA stables,
/// JupUSD) without recompilation.
interface IUnifiedTokenMin {
    function mintId() external view returns (bytes32);
    function snapshotAta(bytes32 ataPubkey) external;
    function isPreDepositedCaller(address who) external view returns (bool);
}
