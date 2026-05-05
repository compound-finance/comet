// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

import {UnifiedToken} from "../unified-token/UnifiedToken.sol";

/// @title MultiAssetWrapperFactory
/// @notice Deploys per-mint UnifiedToken instances and registers them.
///
/// Foundational artifact (Tier B, spec §1b §11a). Compound's deployment uses
/// the factory for at least one collateral wrapper (jitoSOL); Morpho's multi-
/// collateral isolated markets and RWA's per-issuer tokens scale to many
/// wrappers.
///
/// Idempotency: the factory enforces one UnifiedToken per mint. Repeat deploy
/// attempts revert; lookup-then-deploy is the operator pattern.
///
/// Admin: a single admin address can deploy. The factory's admin is set to
/// the deployer at construction; transferAdmin / acceptAdmin matches
/// UnifiedToken's two-step pattern.
contract MultiAssetWrapperFactory {
    address public admin;
    address public pendingAdmin;

    // mint pubkey → UnifiedToken contract address
    mapping(bytes32 => address) public wrapperFor;

    // ordered list of registered mints (for enumeration)
    bytes32[] private _mints;

    event UnifiedTokenDeployed(
        bytes32 indexed mint,
        address indexed wrapper,
        string name,
        string symbol,
        uint8 decimals
    );
    event AdminTransferStarted(address indexed from, address indexed pending);
    event AdminTransferCompleted(address indexed from, address indexed to);

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "MultiAssetWrapperFactory: not admin");
        _;
    }

    /// Deploy a new UnifiedToken for `mint`. Reverts if a wrapper is already
    /// registered for `mint`. The deployed contract's admin is set to
    /// msg.sender (the factory's admin), NOT the factory.
    function deploy(
        bytes32 mint,
        string memory name,
        string memory symbol,
        uint8 dec
    ) external onlyAdmin returns (address) {
        require(wrapperFor[mint] == address(0), "MultiAssetWrapperFactory: already deployed");

        // Pass the factory's admin as the wrapper's admin directly. No
        // post-deploy transferAdmin dance needed.
        UnifiedToken token = new UnifiedToken(mint, name, symbol, dec, msg.sender);

        wrapperFor[mint] = address(token);
        _mints.push(mint);
        emit UnifiedTokenDeployed(mint, address(token), name, symbol, dec);
        return address(token);
    }

    /// Returns all mints registered in this factory.
    function deployedMints() external view returns (bytes32[] memory) {
        return _mints;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "MultiAssetWrapperFactory: not pending admin");
        address old = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferCompleted(old, admin);
    }
}
