// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometExtInterface.sol";

contract CometExt is CometExtInterface {
    /** Public constants **/

    /// @notice The major version of this contract
    string public override constant version = "0";

    /** Internal constants **/

    /// @dev The EIP-712 typehash for the contract's domain
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev The EIP-712 typehash for allowBySig Authorization
    bytes32 internal constant AUTHORIZATION_TYPEHASH = keccak256("Authorization(address owner,address manager,bool isAllowed,uint256 nonce,uint256 expiry)");

    /// @dev The highest valid value for s in an ECDSA signature pair (0 < s < secp256k1n ÷ 2 + 1)
    ///  See https://ethereum.github.io/yellowpaper/paper.pdf #307)
    uint internal constant MAX_VALID_ECDSA_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /** Immutable symbol **/

    /// @dev The ERC20 name for wrapped base token
    bytes32 internal immutable name32;

    /// @dev The ERC20 symbol for wrapped base token
    bytes32 internal immutable symbol32;

    /**
     * @notice Construct a new protocol instance
     * @param config The mapping of initial/constant parameters
     **/
    constructor(ExtConfiguration memory config) {
        name32 = config.name32;
        symbol32 = config.symbol32;
    }

    /** External getters for internal constants **/

    function baseAccrualScale() override external pure returns (uint64) { return BASE_ACCRUAL_SCALE; }
    function baseIndexScale() override external pure returns (uint64) { return BASE_INDEX_SCALE; }
    function factorScale() override external pure returns (uint64) { return FACTOR_SCALE; }
    function priceScale() override external pure returns (uint64) { return PRICE_SCALE; }
    function maxAssets() override external pure returns (uint8) { return MAX_ASSETS; }

    /**
     * @notice Aggregate variables tracked for the entire market
     **/
    function totalsBasic() public override view returns (TotalsBasic memory) {
        return TotalsBasic({
            baseSupplyIndex: baseSupplyIndex,
            baseBorrowIndex: baseBorrowIndex,
            trackingSupplyIndex: trackingSupplyIndex,
            trackingBorrowIndex: trackingBorrowIndex,
            totalSupplyBase: totalSupplyBase,
            totalBorrowBase: totalBorrowBase,
            lastAccrualTime: lastAccrualTime,
            pauseFlags: pauseFlags
        });
    }

    /** Additional ERC20 functionality and approval interface **/

    /**
     * @notice Get the ERC20 name for wrapped base token
     * @return The name as a string
     */
    function name() override public view returns (string memory) {
        uint8 i;
        for (i = 0; i < 32; ) {
            if (name32[i] == 0) {
                break;
            }
            unchecked { i++; }
        }
        bytes memory name_ = new bytes(i);
        for (uint8 j = 0; j < i; ) {
            name_[j] = name32[j];
            unchecked { j++; }
        }
        return string(name_);
    }

    /**
     * @notice Get the ERC20 symbol for wrapped base token
     * @return The symbol as a string
     */
    function symbol() override external view returns (string memory) {
        uint8 i;
        for (i = 0; i < 32; ) {
            if (symbol32[i] == 0) {
                break;
            }
            unchecked { i++; }
        }
        bytes memory symbol_ = new bytes(i);
        for (uint8 j = 0; j < i; ) {
            symbol_[j] = symbol32[j];
            unchecked { j++; }
        }
        return string(symbol_);
    }

    /**
     * @notice Query the current collateral balance of an account
     * @param account The account whose balance to query
     * @param asset The collateral asset to check the balance for
     * @return The collateral balance of the account
     */
    function collateralBalanceOf(address account, address asset) override external view returns (uint128) {
        return userCollateral[account][asset].balance;
    }

    /**
     * @notice Query the total accrued base rewards for an account
     * @param account The account to query
     * @return The accrued rewards, scaled by `BASE_ACCRUAL_SCALE`
     */
    function baseTrackingAccrued(address account) override external view returns (uint64) {
        return userBasic[account].baseTrackingAccrued;
    }

    /**
      * @notice Approve or disallow `spender` to transfer on sender's behalf
      * @dev Note: this binary approval is unlike most other ERC20 tokens
      * @dev Note: this grants full approval for spender to manage *all* the owner's assets
      * @param spender The address of the account which may transfer tokens
      * @param amount Either uint.max (to allow) or zero (to disallow)
      * @return Whether or not the approval change succeeded
      */
    function approve(address spender, uint256 amount) override external returns (bool) {
        if (amount == type(uint256).max) {
            allowInternal(msg.sender, spender, true);
        } else if (amount == 0) {
            allowInternal(msg.sender, spender, false);
        } else {
            revert BadAmount();
        }
        return true;
    }

    /**
      * @notice Get the current allowance from `owner` for `spender`
      * @dev Note: this binary allowance is unlike most other ERC20 tokens
      * @dev Note: this allowance allows spender to manage *all* the owner's assets
      * @param owner The address of the account which owns the tokens to be spent
      * @param spender The address of the account which may transfer tokens
      * @return Either uint.max (spender is allowed) or zero (spender is disallowed)
      */
    function allowance(address owner, address spender) override external view returns (uint256) {
        return hasPermission(owner, spender) ? type(uint256).max : 0;
    }

    /**
     * @notice Allow or disallow another address to withdraw, or transfer from the sender
     * @param manager The account which will be allowed or disallowed
     * @param isAllowed_ Whether to allow or disallow
     */
    function allow(address manager, bool isAllowed_) override external {
        allowInternal(msg.sender, manager, isAllowed_);
    }

    /**
     * @dev Stores the flag marking whether the manager is allowed to act on behalf of owner
     */
    function allowInternal(address owner, address manager, bool isAllowed_) internal {
        isAllowed[owner][manager] = isAllowed_;
        emit Approval(owner, manager, isAllowed_ ? type(uint256).max : 0);
    }

    /**
     * @notice Sets authorization status for a manager via signature from signatory
     * @param owner The address that signed the signature
     * @param manager The address to authorize (or rescind authorization from)
     * @param isAllowed_ Whether to authorize or rescind authorization from manager
     * @param nonce The next expected nonce value for the signatory
     * @param expiry Expiration time for the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function allowBySig(
        address owner,
        address manager,
        bool isAllowed_,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) override external {
        if (uint256(s) > MAX_VALID_ECDSA_S) revert InvalidValueS();
        // v ∈ {27, 28} (source: https://ethereum.github.io/yellowpaper/paper.pdf #308)
        if (v != 27 && v != 28) revert InvalidValueV();
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name())), keccak256(bytes(version)), block.chainid, address(this)));
        bytes32 structHash = keccak256(abi.encode(AUTHORIZATION_TYPEHASH, owner, manager, isAllowed_, nonce, expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signatory = ecrecover(digest, v, r, s);
        if (signatory == address(0)) revert BadSignatory();
        if (owner != signatory) revert BadSignatory();
        if (nonce != userNonce[signatory]++) revert BadNonce();
        if (block.timestamp >= expiry) revert SignatureExpired();
        allowInternal(signatory, manager, isAllowed_);
    }
}