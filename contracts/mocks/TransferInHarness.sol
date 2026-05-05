// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

/// @title TransferInHarness
/// @notice Embeds the Phase 3-patched `doTransferIn` body verbatim so unit
/// tests can validate the branch behavior without dragging in Comet's full
/// dependency graph.
///
/// The exact code below MUST match `Comet.sol::doTransferIn` after the
/// Phase 3 patch. If the production Comet ever diverges, this harness is
/// the canary. Keep both in lockstep.

interface IUnifiedTokenMin2 {
    function snapshotAta(bytes32 ataPubkey) external;
    function transferFromPreDeposited(
        address from,
        address to,
        bytes32 recipientAta,
        uint256 value
    ) external;
    function solanaAtaOf(address account) external view returns (bytes32);
    function isPreDepositedCaller(address who) external view returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC20Min {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract TransferInHarness {
    address public immutable baseToken;

    error TransferInFailed();

    constructor(address baseToken_) {
        baseToken = baseToken_;
    }

    /// Test helper: pushes a snapshot for `address(this)`'s ATA. Mimics what
    /// the OrchestratorRouter would do prior to triggering doTransferIn.
    function callSnapshot() external {
        bytes32 myAta = IUnifiedTokenMin2(baseToken).solanaAtaOf(address(this));
        IUnifiedTokenMin2(baseToken).snapshotAta(myAta);
    }

    function callDoTransferIn(address from, uint256 amount) external {
        _doTransferIn(baseToken, from, amount);
    }

    function callDoTransferInNonBase(
        address asset,
        address from,
        uint256 amount
    ) external {
        _doTransferIn(asset, from, amount);
    }

    /// Verbatim Phase-3-patched doTransferIn (truncated to the bits this
    /// harness needs).
    function _doTransferIn(
        address asset,
        address from,
        uint256 amount
    ) internal returns (uint256) {
        uint256 preTransferBalance = IERC20Min(asset).balanceOf(address(this));

        if (asset == baseToken) {
            try IUnifiedTokenMin2(asset).isPreDepositedCaller(from) returns (bool isPre) {
                if (isPre) {
                    bytes32 cometAta = IUnifiedTokenMin2(asset).solanaAtaOf(address(this));
                    IUnifiedTokenMin2(asset).transferFromPreDeposited(
                        from, address(this), cometAta, amount
                    );
                    return IERC20Min(asset).balanceOf(address(this)) - preTransferBalance;
                }
            } catch {}
        }

        IERC20Min(asset).transferFrom(from, address(this), amount);
        bool success;
        assembly ("memory-safe") {
            switch returndatasize()
                case 0 { success := not(0) }
                case 32 {
                    returndatacopy(0, 0, 32)
                    success := mload(0)
                }
                default { revert(0, 0) }
        }
        if (!success) revert TransferInFailed();
        return IERC20Min(asset).balanceOf(address(this)) - preTransferBalance;
    }
}
