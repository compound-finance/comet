// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometBase.sol";

contract CometExt is CometBase {
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    /// @notice The name of this contract
    string public constant name = "Compound Comet";

    /// @notice The name of this contract
    string public constant symbol = unicode"📈BASE";

    /// @notice The major version of this contract
    string public constant version = "0";

    /// @dev The EIP-712 typehash for the contract's domain
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev The EIP-712 typehash for allowBySig Authorization
    bytes32 internal constant AUTHORIZATION_TYPEHASH = keccak256("Authorization(address owner,address manager,bool isAllowed,uint256 nonce,uint256 expiry)");

    /// @dev The highest valid value for s in an ECDSA signature pair (0 < s < secp256k1n ÷ 2 + 1)
    ///  See https://ethereum.github.io/yellowpaper/paper.pdf #307)
    uint internal constant MAX_VALID_ECDSA_S = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /**
     * @notice Get the total number of tokens in circulation
     * @return The supply of tokens
     **/
    function totalSupply() external view returns (uint256) {
        return presentValueSupply(baseSupplyIndex, totalSupplyBase);
    }

    /**
     * @notice Query the current positive base balance of an account or zero
     * @param account The account whose balance to query
     * @return The present day base balance magnitude of the account, if positive
     */
    function balanceOf(address account) external view returns (uint256) {
        int104 principal = userBasic[account].principal;
        return principal > 0 ? presentValueSupply(baseSupplyIndex, unsigned104(principal)) : 0;
    }

    /**
     * @notice Query the current negative base balance of an account or zero
     * @param account The account whose balance to query
     * @return The present day base balance magnitude of the account, if negative
     */
    function borrowBalanceOf(address account) external view returns (uint256) {
        int104 principal = userBasic[account].principal;
        return principal < 0 ? presentValueBorrow(baseBorrowIndex, unsigned104(-principal)) : 0;
    }

     /**
      * @notice Query the current base balance of an account
      * @param account The account whose balance to query
      * @return The present day base balance of the account
      */
    function baseBalanceOf(address account) external view returns (int104) {
        return presentValue(userBasic[account].principal);
    }

    /**
     * @notice Query the current collateral balance of an account
     * @param account The account whose balance to query
     * @param asset The collateral asset whi
     * @return The collateral balance of the account
     */
    function collateralBalanceOf(address account, address asset) external view returns (uint128) {
        return userCollateral[account][asset].balance;
    }

    /**
      * @notice Approve or disallow `spender` to transfer on sender's behalf
      * @param spender The address of the account which may transfer tokens
      * @param amount Either uint.max (to allow) or zero (to disallow)
      * @return Whether or not the approval change succeeded
      */
    function approve(address spender, uint256 amount) external returns (bool) {
        if (amount == type(uint256).max) {
            allowInternal(msg.sender, spender, true);
        } else if (amount == 0) {
            allowInternal(msg.sender, spender, false);
        } else {
            revert("bad approval amount");
        }
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
      * @notice Get the current allowance from `owner` for `spender`
      * @param owner The address of the account which owns the tokens to be spent
      * @param spender The address of the account which may transfer tokens
      * @return Either uint.max (spender is allowed) or zero (spender is disallowed)
      */
    function allowance(address owner, address spender) external view returns (uint256) {
        return hasPermission(owner, spender) ? type(uint256).max : 0;
    }

    /**
     * @notice Allow or disallow another address to withdraw, or transfer from the sender
     * @param manager The account which will be allowed or disallowed
     * @param isAllowed_ Whether to allow or disallow
     */
    function allow(address manager, bool isAllowed_) external {
        allowInternal(msg.sender, manager, isAllowed_);
    }

    /**
     * @dev Stores the flag marking whether the manager is allowed to act on behalf of owner
     */
    function allowInternal(address owner, address manager, bool isAllowed_) internal {
        isAllowed[owner][manager] = isAllowed_;
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
    ) external {
        require(uint256(s) <= MAX_VALID_ECDSA_S, "invalid value: s");
        // v ∈ {27, 28} (source: https://ethereum.github.io/yellowpaper/paper.pdf #308)
        require(v == 27 || v == 28, "invalid value: v");
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), block.chainid, address(this)));
        bytes32 structHash = keccak256(abi.encode(AUTHORIZATION_TYPEHASH, owner, manager, isAllowed_, nonce, expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signatory = ecrecover(digest, v, r, s);
        require(owner == signatory, "owner is not signatory");
        require(nonce == userNonce[signatory]++, "invalid nonce");
        require(block.timestamp < expiry, "signed transaction expired");
        allowInternal(signatory, manager, isAllowed_);
    }
}