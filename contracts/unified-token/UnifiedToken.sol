// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {ICrossVMAsset} from "../interfaces/ICrossVMAsset.sol";
import {AtaDeriver} from "../lib/AtaDeriver.sol";
import {SplDataParser} from "../lib/SplDataParser.sol";
import {
    ICrossProgramInvocation,
    CpiProgram,
    SystemProgram,
    SolanaConstants,
    CPI_PROGRAM_ADDRESS
} from "../lib/RomePrecompiles.sol";

/// @title UnifiedToken
/// @notice Generic ERC-20 wrapper around an arbitrary Solana SPL mint.
///
/// One compiled artifact serves Compound's USDC base, Sky's USDS, Jupiter's
/// JupUSD, RWA stables, etc. — instantiate with the appropriate Solana mint
/// pubkey at construction. See spec §1b + §11a.
///
/// Wallet-canonical model: balances live in the user's authority-PDA's ATA
/// on Solana. balanceOf reads it. transfer / transferFrom on the EVM lane
/// CPIs to SPL Token, signed as the supplier's authority PDA.
///
/// Solana lane: orchestrator program executes an SPL transfer to the
/// protocol's PDA's ATA in the same Solana tx as the EVM call. The EVM call
/// uses transferFromPreDeposited(...) — verifies the ATA delta, emits a
/// matching IERC20.Transfer event, no CPI.
///
/// Allowances are EVM-side (mapping). SPL's delegate model is NOT used —
/// Compound's audit assumes ERC-20 semantics, and the SPL_ERC20 wrapper's
/// dual model has been a source of contract-spender bugs.
///
/// Permit support: ERC-2612 EIP-712 signed approvals, used by the Phase 3
/// MetaHook callee for gasless allowance grants.
contract UnifiedToken is ICrossVMAsset, EIP712, ReentrancyGuard, IERC165 {
    // ────────────────────────────────────────────────────────────────────
    // Identity / immutable state
    // ────────────────────────────────────────────────────────────────────

    bytes32 public immutable override mintId;
    uint8 private immutable _decimals;
    string private _name;
    string private _symbol;

    // ICrossVMAsset interface ID (manually computed, see _ICROSS_VM_ASSET_ID).
    bytes4 public constant ICROSS_VM_ASSET_INTERFACE_ID = 0x9e1be3ad;

    // ────────────────────────────────────────────────────────────────────
    // EVM-side allowance state
    // ────────────────────────────────────────────────────────────────────

    mapping(address => mapping(address => uint256)) private _allowances;

    // ────────────────────────────────────────────────────────────────────
    // ERC-2612 permit
    // ────────────────────────────────────────────────────────────────────

    bytes32 private constant _PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    mapping(address => uint256) private _nonces;

    // ────────────────────────────────────────────────────────────────────
    // Pre-deposited snapshot state (Solana lane)
    // ────────────────────────────────────────────────────────────────────

    /// FIFO queue of snapshots per ATA. Each `snapshotAta` push records the
    /// current ATA balance; `transferFromPreDeposited` pops the head.
    /// Storing as an array per-ATA permits multiple in-flight snapshots in
    /// the same tx (e.g. supply→withdraw→re-supply composition).
    mapping(bytes32 => uint256[]) private _snapshotQueue;

    mapping(address => bool) private _preDepositedCallers;

    // ────────────────────────────────────────────────────────────────────
    // Admin
    // ────────────────────────────────────────────────────────────────────

    address public override admin;
    address public override pendingAdmin;

    // ────────────────────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────────────────────

    /// @param mint_         Canonical Solana SPL mint pubkey (bytes32).
    /// @param name_         Display name (e.g. "Unified USDC").
    /// @param symbol_       Display symbol (e.g. "USDC").
    /// @param decimals_     Display decimals (must equal the SPL mint's
    ///                      decimals; we sanity-bound 0..18).
    /// @param admin_        Initial admin (role mgmt). For direct deploys
    ///                      pass msg.sender; for factory deploys pass the
    ///                      factory's admin.
    constructor(
        bytes32 mint_,
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address admin_
    ) EIP712(name_, "1") {
        require(mint_ != bytes32(0), "UnifiedToken: mint cannot be zero");
        require(decimals_ <= 18, "UnifiedToken: decimals out of range");
        require(admin_ != address(0), "UnifiedToken: zero admin");

        mintId = mint_;
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        admin = admin_;
    }

    // ────────────────────────────────────────────────────────────────────
    // IERC20Metadata
    // ────────────────────────────────────────────────────────────────────

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // ────────────────────────────────────────────────────────────────────
    // IERC20 reads
    // ────────────────────────────────────────────────────────────────────

    function totalSupply() public view override returns (uint256) {
        return uint256(SplDataParser.loadMintSupply(mintId));
    }

    /// @notice Returns the user's SPL balance from their authority-PDA's ATA.
    /// @dev Same source bridgeOutToSolana spends from in SPL_ERC20 — reads
    /// what Phantom would show. Bridged-in users (CCTP mint to auth-PDA's ATA),
    /// Solana-lane suppliers, and EVM-lane post-supply state all converge here.
    function balanceOf(address account) public view override returns (uint256) {
        bytes32 ata = AtaDeriver.ataForUser(account, mintId);
        return uint256(SplDataParser.loadTokenAmount(ata));
    }

    function allowance(address owner, address spender) public view override returns (uint256) {
        return _allowances[owner][spender];
    }

    // ────────────────────────────────────────────────────────────────────
    // IERC20 writes
    // ────────────────────────────────────────────────────────────────────

    function transfer(address to, uint256 value) public override nonReentrant returns (bool) {
        _transferViaCpi(msg.sender, to, value);
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value)
        public
        override
        nonReentrant
        returns (bool)
    {
        _spendAllowance(from, msg.sender, value);
        // Phase 2: `from`'s prior `approve(spender=msg.sender, ...)` set up
        // both the EVM allowance AND the SPL-side delegation: the call
        // CPIed to SPL Token's `Approve`, granting AUTHORITY_PDA(msg.sender)
        // delegate authority on `from`'s ATA up to the approved amount.
        // The CPI below issues `transfer_checked` signed as AUTHORITY_PDA(msg.sender)
        // — SPL Token honors the prior delegation and the transfer succeeds.
        _transferViaCpiAsSpender(from, to, value, msg.sender);
        emit Transfer(from, to, value);
        return true;
    }

    /// @notice Sets EVM-side allowance AND mirrors as an SPL delegate on Solana.
    /// @dev Phase 2 (operator decision 2026-05-05): approve does double duty.
    ///      1. Sets _allowances[msg.sender][spender] (standard ERC-20).
    ///      2. CPIs to SPL Token's `Approve` instruction so msg.sender's
    ///         AUTHORITY_PDA grants `AUTHORITY_PDA(spender)` delegate authority
    ///         on the source ATA, with the same amount.
    ///      3. When value=0, CPIs to SPL Token's `Revoke` to clear the SPL
    ///         delegate; otherwise stale on-chain delegations would persist.
    ///      Result: Compound's `transferFrom(user, comet, amount)` now works
    ///      end-to-end without a separate Solana wallet step. The CPI in
    ///      transferFrom signs as AUTHORITY_PDA(comet); the SPL delegate set
    ///      up here authorizes that exact PDA.
    function approve(address spender, uint256 value) public override nonReentrant returns (bool) {
        _approve(msg.sender, spender, value);
        if (value == 0) {
            _revokeSplDelegate();
        } else {
            _approveSplDelegate(spender, value);
        }
        return true;
    }

    function increaseAllowance(address spender, uint256 added) public nonReentrant returns (bool) {
        uint256 newAllowance = _allowances[msg.sender][spender] + added;
        _approve(msg.sender, spender, newAllowance);
        // SPL delegate: re-issue Approve with the new total. SPL Token's
        // Approve overwrites the existing delegate amount (it does not
        // accumulate), so we pass newAllowance.
        if (newAllowance == 0) {
            _revokeSplDelegate();
        } else {
            _approveSplDelegate(spender, newAllowance);
        }
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtracted) public nonReentrant returns (bool) {
        uint256 current = _allowances[msg.sender][spender];
        require(current >= subtracted, "ERC20: decreased allowance below zero");
        unchecked {
            uint256 newAllowance = current - subtracted;
            _approve(msg.sender, spender, newAllowance);
            if (newAllowance == 0) {
                _revokeSplDelegate();
            } else {
                _approveSplDelegate(spender, newAllowance);
            }
        }
        return true;
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal {
        uint256 current = _allowances[owner][spender];
        if (current != type(uint256).max) {
            require(current >= value, "ERC20: insufficient allowance");
            unchecked {
                _allowances[owner][spender] = current - value;
            }
        }
    }

    function _approve(address owner, address spender, uint256 value) internal {
        require(spender != address(0), "ERC20: approve to the zero address");
        _allowances[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    // ────────────────────────────────────────────────────────────────────
    // ICrossVMAsset extensions — identity
    // ────────────────────────────────────────────────────────────────────

    function solanaAtaOf(address account) public view override returns (bytes32) {
        return AtaDeriver.ataForUser(account, mintId);
    }

    // ────────────────────────────────────────────────────────────────────
    // ICrossVMAsset extensions — pre-deposited mode
    // ────────────────────────────────────────────────────────────────────

    function snapshotAta(bytes32 ataPubkey) external override {
        require(_preDepositedCallers[msg.sender], "UnifiedToken: not pre-deposited caller");
        uint64 prior = SplDataParser.loadTokenAmount(ataPubkey);
        _snapshotQueue[ataPubkey].push(uint256(prior));
        emit AtaSnapshotted(msg.sender, ataPubkey, uint256(prior));
    }

    function transferFromPreDeposited(
        address from,
        address to,
        bytes32 recipientAta,
        uint256 value
    ) external override nonReentrant {
        require(_preDepositedCallers[msg.sender], "UnifiedToken: not pre-deposited caller");
        require(value <= type(uint64).max, "UnifiedToken: amount exceeds uint64");

        uint256 queueLen = _snapshotQueue[recipientAta].length;
        require(queueLen > 0, "UnifiedToken: no snapshot");

        // Pop FIFO head — first snapshot taken is first verified.
        uint256 prior = _snapshotQueue[recipientAta][0];
        // Shift array (gas-cost vs a pointer-cursor: queueLen is typically 1
        // for steady-state Compound flow; for compositional flows we accept
        // the O(N) shift).
        for (uint256 i = 1; i < queueLen; ++i) {
            _snapshotQueue[recipientAta][i - 1] = _snapshotQueue[recipientAta][i];
        }
        _snapshotQueue[recipientAta].pop();

        uint256 nowBal = uint256(SplDataParser.loadTokenAmount(recipientAta));
        require(nowBal >= prior + value, "UnifiedToken: insufficient pre-deposit");

        emit Transfer(from, to, value);
        emit PreDepositedTransfer(from, recipientAta, value);
    }

    // ────────────────────────────────────────────────────────────────────
    // ICrossVMAsset extensions — admin
    // ────────────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "UnifiedToken: not admin");
        _;
    }

    function isPreDepositedCaller(address who) external view override returns (bool) {
        return _preDepositedCallers[who];
    }

    function grantPreDepositedCaller(address who) external override onlyAdmin {
        require(who != address(0), "UnifiedToken: zero caller");
        _preDepositedCallers[who] = true;
        emit PreDepositedCallerGranted(who);
    }

    function revokePreDepositedCaller(address who) external override onlyAdmin {
        _preDepositedCallers[who] = false;
        emit PreDepositedCallerRevoked(who);
    }

    function transferAdmin(address newAdmin) external override onlyAdmin {
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external override {
        require(msg.sender == pendingAdmin, "UnifiedToken: not pending admin");
        address old = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferCompleted(old, admin);
    }

    // ────────────────────────────────────────────────────────────────────
    // ERC-2612 permit
    // ────────────────────────────────────────────────────────────────────

    /// @notice ERC-2612 signed approval. Sets EVM allowance ONLY — does not
    /// CPI to SPL Token's Approve. Rationale: permit's signing key is the
    /// EVM private key, which is not the AUTHORITY_PDA owner — there's no
    /// way for permit to sign as AUTHORITY_PDA(owner) on Solana without an
    /// additional Solana-side action by the owner. Use `approve()` directly
    /// (called by msg.sender == owner) when SPL delegation is needed.
    /// Compound's standard supply path uses approve() not permit, so this
    /// works for the demo. If a permit-based flow is needed, the caller
    /// must do a separate `approve()` follow-up to set the SPL delegate.
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");
        bytes32 structHash = keccak256(abi.encode(
            _PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline
        ));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner, "ERC20Permit: invalid signature");
        _approve(owner, spender, value);
    }

    function nonces(address owner) public view returns (uint256) {
        return _nonces[owner];
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _useNonce(address owner) internal returns (uint256 current) {
        current = _nonces[owner];
        unchecked { _nonces[owner] = current + 1; }
    }

    // ────────────────────────────────────────────────────────────────────
    // ERC-165
    // ────────────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC20).interfaceId
            || interfaceId == type(IERC20Metadata).interfaceId
            || interfaceId == ICROSS_VM_ASSET_INTERFACE_ID
            || interfaceId == type(IERC165).interfaceId;
    }

    // ────────────────────────────────────────────────────────────────────
    // Internal: CPI to SPL Token transfer_checked
    // ────────────────────────────────────────────────────────────────────

    /// Issues a signed CPI to SPL Token's `transfer_checked` instruction
    /// where the authority signer is AUTHORITY_PDA(`from`) — i.e. the source
    /// owner is signing. Used by direct `transfer()`.
    /// Source ATA = AUTHORITY_PDA(`from`)'s ATA for this mint.
    /// Destination ATA = AUTHORITY_PDA(`to`)'s ATA for this mint.
    function _transferViaCpi(address from, address to, uint256 value) internal {
        _transferViaCpiAsSpender(from, to, value, from);
    }

    /// Issues a signed CPI to SPL Token's `transfer_checked` where the
    /// authority signer is AUTHORITY_PDA(`spender`). Used by `transferFrom`
    /// where the spender (a delegate established via `approve`) initiates the
    /// transfer of `from`'s funds. SPL Token's transfer_checked verifies the
    /// signing authority is either the ATA owner OR a registered delegate.
    function _transferViaCpiAsSpender(
        address from,
        address to,
        uint256 value,
        address spender
    ) internal {
        require(to != address(0), "ERC20: transfer to the zero address");
        require(value <= type(uint64).max, "UnifiedToken: amount exceeds uint64");

        bytes32 fromAta = AtaDeriver.ataForUser(from, mintId);
        bytes32 toAta = AtaDeriver.ataForUser(to, mintId);
        bytes32 spenderPda = AtaDeriver.authorityPda(spender);

        // Build accounts for transfer_checked.
        ICrossProgramInvocation.AccountMeta[] memory accounts =
            new ICrossProgramInvocation.AccountMeta[](4);
        accounts[0] = ICrossProgramInvocation.AccountMeta(fromAta, false, true);
        accounts[1] = ICrossProgramInvocation.AccountMeta(mintId, false, false);
        accounts[2] = ICrossProgramInvocation.AccountMeta(toAta, false, true);
        accounts[3] = ICrossProgramInvocation.AccountMeta(spenderPda, true, false);

        // transfer_checked tag = 12, then u64 LE amount, then u8 decimals.
        bytes memory data = bytes.concat(
            bytes1(uint8(12)),
            _u64Le(uint64(value)),
            bytes1(_decimals)
        );

        bytes32[] memory seeds = new bytes32[](0);

        // Use delegatecall to invoke_signed so the precompile sees this
        // contract's caller frame as the signer. Per
        // rome-evm-private/program/src/non_evm/cpi_ix.rs:invoke_signed_ix —
        // the precompile derives the AUTHORITY_PDA from
        // `params.context.caller`, which (under delegatecall) is the original
        // caller of UnifiedToken.transfer/transferFrom. That's the desired
        // signer (the spender / the from-address). Same pattern as
        // SPL_ERC20._transfer in rome-solidity.
        (bool success, bytes memory result) = CPI_PROGRAM_ADDRESS.delegatecall(
            abi.encodeWithSignature(
                "invoke_signed(bytes32,(bytes32,bool,bool)[],bytes,bytes32[])",
                SolanaConstants.SPL_TOKEN_PROGRAM,
                accounts,
                data,
                seeds
            )
        );
        require(success, _revertMsg(result));
    }

    /// CPIs to SPL Token's `Approve` instruction.
    /// Owner = AUTHORITY_PDA(msg.sender) (signs).
    /// Source ATA = AUTHORITY_PDA(msg.sender)'s ATA for this mint.
    /// Delegate = AUTHORITY_PDA(spender). When the spender later calls
    /// transferFrom, the CPI is signed as AUTHORITY_PDA(spender) and SPL
    /// Token honors the delegation.
    /// SPL Approve instruction tag = 4, payload = u64 LE amount.
    /// @dev If the EVM allowance is greater than u64::MAX (e.g. `type(uint256).max`
    /// for "infinite" allowance), we cap the SPL delegate at u64::MAX. SPL Token's
    /// transfer_checked will then succeed for any single transfer up to u64::MAX,
    /// which exceeds any realistic per-call amount; the EVM allowance is the
    /// authoritative cap for accumulated transfers.
    function _approveSplDelegate(address spender, uint256 amount) internal {
        uint64 splAmount = amount > type(uint64).max
            ? type(uint64).max
            : uint64(amount);
        bytes32 ownerAta = AtaDeriver.ataForUser(msg.sender, mintId);
        bytes32 ownerPda = AtaDeriver.authorityPda(msg.sender);
        bytes32 delegatePda = AtaDeriver.authorityPda(spender);

        ICrossProgramInvocation.AccountMeta[] memory accounts =
            new ICrossProgramInvocation.AccountMeta[](3);
        accounts[0] = ICrossProgramInvocation.AccountMeta(ownerAta, false, true);
        accounts[1] = ICrossProgramInvocation.AccountMeta(delegatePda, false, false);
        accounts[2] = ICrossProgramInvocation.AccountMeta(ownerPda, true, false);

        bytes memory data = bytes.concat(
            bytes1(uint8(4)),
            _u64Le(splAmount)
        );

        bytes32[] memory seeds = new bytes32[](0);
        (bool success, bytes memory result) = CPI_PROGRAM_ADDRESS.delegatecall(
            abi.encodeWithSignature(
                "invoke_signed(bytes32,(bytes32,bool,bool)[],bytes,bytes32[])",
                SolanaConstants.SPL_TOKEN_PROGRAM,
                accounts,
                data,
                seeds
            )
        );
        require(success, _revertMsg(result));
    }

    /// CPIs to SPL Token's `Revoke` instruction.
    /// Source ATA = AUTHORITY_PDA(msg.sender)'s ATA for this mint.
    /// Owner = AUTHORITY_PDA(msg.sender) (signs).
    /// SPL Revoke instruction tag = 5, no payload.
    function _revokeSplDelegate() internal {
        bytes32 ownerAta = AtaDeriver.ataForUser(msg.sender, mintId);
        bytes32 ownerPda = AtaDeriver.authorityPda(msg.sender);

        ICrossProgramInvocation.AccountMeta[] memory accounts =
            new ICrossProgramInvocation.AccountMeta[](2);
        accounts[0] = ICrossProgramInvocation.AccountMeta(ownerAta, false, true);
        accounts[1] = ICrossProgramInvocation.AccountMeta(ownerPda, true, false);

        bytes memory data = bytes.concat(bytes1(uint8(5)));
        bytes32[] memory seeds = new bytes32[](0);
        (bool success, bytes memory result) = CPI_PROGRAM_ADDRESS.delegatecall(
            abi.encodeWithSignature(
                "invoke_signed(bytes32,(bytes32,bool,bool)[],bytes,bytes32[])",
                SolanaConstants.SPL_TOKEN_PROGRAM,
                accounts,
                data,
                seeds
            )
        );
        require(success, _revertMsg(result));
    }

    // ────────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────────

    function _u64Le(uint64 v) private pure returns (bytes memory) {
        bytes memory out = new bytes(8);
        for (uint256 i = 0; i < 8; ++i) {
            out[i] = bytes1(uint8(v >> (i * 8)));
        }
        return out;
    }

    function _revertMsg(bytes memory data) private pure returns (string memory) {
        if (data.length < 68) return "UnifiedToken: CPI failed";
        assembly { data := add(data, 0x04) }
        return abi.decode(data, (string));
    }

}
