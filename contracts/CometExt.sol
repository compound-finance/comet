// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometExtInterface.sol";
import "./CometMainInterface.sol";

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

    /** Modifiers **/

    /**
     * @dev Modifier to check if the sender is the governor or pause guardian
     */
    modifier onlyGovernorOrPauseGuardian() {
        if (msg.sender != CometMainInterface(address(this)).governor() && 
        msg.sender != CometMainInterface(address(this)).pauseGuardian()) 
            revert OnlyPauseGuardianOrGovernor();
        _;
    }

    /**
     * @dev Modifier to check if the asset index is valid
     * @param assetIndex The index of the asset
     */
    modifier isValidAssetIndex(uint24 assetIndex) {
        if (assetIndex >= CometMainInterface(address(this)).numAssets()) revert InvalidAssetIndex();
        _;
    }

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
    function maxAssets() override virtual external pure returns (uint8) { return MAX_ASSETS; }

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

    /*//////////////////////////////////////////////////////////////
                        EXTENDED PAUSE CONTROL
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Set the status of a pause offset
     * @param offset The offset to set
     * @param paused The new status of the pause offset
     */
    function setPauseFlag(uint24 offset, bool paused) internal {
        paused ? extendedPauseFlags |= (uint24(1) << offset) : extendedPauseFlags &= ~(uint24(1) << offset);
    }

    /**
     * @notice Get the current status of a pause offset
     * @param offset The offset to check
     * @return The current status of the pause offset
     */
    function currentPauseOffsetStatus(uint24 offset) internal view returns (bool) {
        return (extendedPauseFlags & (uint24(1) << offset)) != 0;
    }

    /**
     * @notice Check if the collateral asset is deactivated
     * @param assetIndex The index of the collateral asset
     * @return Whether the collateral asset is deactivated
     */
    function isCollateralDeactivated(uint24 assetIndex) public view returns (bool) {
        return (deactivatedCollaterals & (uint24(1) << assetIndex) != 0) == true;
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseLendersWithdraw(bool paused) override external onlyGovernorOrPauseGuardian {
        if (currentPauseOffsetStatus(PAUSE_LENDERS_WITHDRAW_OFFSET) == paused) revert OffsetStatusAlreadySet(PAUSE_LENDERS_WITHDRAW_OFFSET, paused);

        setPauseFlag(PAUSE_LENDERS_WITHDRAW_OFFSET, paused);

        emit LendersWithdrawPauseAction(paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseBorrowersWithdraw(bool paused) override external onlyGovernorOrPauseGuardian {
        if (currentPauseOffsetStatus(PAUSE_BORROWERS_WITHDRAW_OFFSET) == paused) revert OffsetStatusAlreadySet(PAUSE_BORROWERS_WITHDRAW_OFFSET, paused);

        setPauseFlag(PAUSE_BORROWERS_WITHDRAW_OFFSET, paused);

        emit BorrowersWithdrawPauseAction(paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseCollateralWithdraw(bool paused) override external onlyGovernorOrPauseGuardian {
        if (currentPauseOffsetStatus(PAUSE_COLLATERALS_WITHDRAW_OFFSET) == paused) revert OffsetStatusAlreadySet(PAUSE_COLLATERALS_WITHDRAW_OFFSET, paused);

        setPauseFlag(PAUSE_COLLATERALS_WITHDRAW_OFFSET, paused);

        emit CollateralWithdrawPauseAction(paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseCollateralAssetWithdraw(uint24 assetIndex, bool paused) override external onlyGovernorOrPauseGuardian isValidAssetIndex(assetIndex) {
        if ((collateralsWithdrawPauseFlags & (uint24(1) << assetIndex) != 0) == paused) revert CollateralAssetOffsetStatusAlreadySet(collateralsWithdrawPauseFlags, assetIndex, paused);

        paused ? collateralsWithdrawPauseFlags |= (uint24(1) << assetIndex) : collateralsWithdrawPauseFlags &= ~(uint24(1) << assetIndex);

        emit CollateralAssetWithdrawPauseAction(assetIndex, paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseCollateralSupply(bool paused) override external onlyGovernorOrPauseGuardian {
        if (currentPauseOffsetStatus(PAUSE_COLLATERAL_SUPPLY_OFFSET) == paused) revert OffsetStatusAlreadySet(PAUSE_COLLATERAL_SUPPLY_OFFSET, paused);

        setPauseFlag(PAUSE_COLLATERAL_SUPPLY_OFFSET, paused);
        
        emit CollateralSupplyPauseAction(paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseBaseSupply(bool paused) override external onlyGovernorOrPauseGuardian {
        if (currentPauseOffsetStatus(PAUSE_BASE_SUPPLY_OFFSET) == paused) revert OffsetStatusAlreadySet(PAUSE_BASE_SUPPLY_OFFSET, paused);

        setPauseFlag(PAUSE_BASE_SUPPLY_OFFSET, paused);

        emit BaseSupplyPauseAction(paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseCollateralAssetSupply(uint24 assetIndex, bool paused) override external onlyGovernorOrPauseGuardian isValidAssetIndex(assetIndex) {
        if ((collateralsSupplyPauseFlags & (uint24(1) << assetIndex) != 0) == paused) revert CollateralAssetOffsetStatusAlreadySet(collateralsSupplyPauseFlags, assetIndex, paused);
        if (!paused && isCollateralDeactivated(assetIndex)) revert CollateralIsDeactivated(assetIndex);

        paused ? collateralsSupplyPauseFlags |= (uint24(1) << assetIndex) : collateralsSupplyPauseFlags &= ~(uint24(1) << assetIndex);

        emit CollateralAssetSupplyPauseAction(assetIndex, paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseLendersTransfer(bool paused) override external onlyGovernorOrPauseGuardian {
        if (currentPauseOffsetStatus(PAUSE_LENDERS_TRANSFER_OFFSET) == paused) revert OffsetStatusAlreadySet(PAUSE_LENDERS_TRANSFER_OFFSET, paused);

        setPauseFlag(PAUSE_LENDERS_TRANSFER_OFFSET, paused);

        emit LendersTransferPauseAction(paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseBorrowersTransfer(bool paused) override external onlyGovernorOrPauseGuardian {
        if (currentPauseOffsetStatus(PAUSE_BORROWERS_TRANSFER_OFFSET) == paused) revert OffsetStatusAlreadySet(PAUSE_BORROWERS_TRANSFER_OFFSET, paused);

        setPauseFlag(PAUSE_BORROWERS_TRANSFER_OFFSET, paused);

        emit BorrowersTransferPauseAction(paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseCollateralTransfer(bool paused) override external onlyGovernorOrPauseGuardian {
        if (currentPauseOffsetStatus(PAUSE_COLLATERALS_TRANSFER_OFFSET) == paused) revert OffsetStatusAlreadySet(PAUSE_COLLATERALS_TRANSFER_OFFSET, paused);

        setPauseFlag(PAUSE_COLLATERALS_TRANSFER_OFFSET, paused);

        emit CollateralTransferPauseAction(paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function pauseCollateralAssetTransfer(uint24 assetIndex, bool paused) override external onlyGovernorOrPauseGuardian isValidAssetIndex(assetIndex) {
        if ((collateralsTransferPauseFlags & (uint24(1) << assetIndex) != 0) == paused) revert CollateralAssetOffsetStatusAlreadySet(collateralsTransferPauseFlags, assetIndex, paused);
        if (!paused && isCollateralDeactivated(assetIndex)) revert CollateralIsDeactivated(assetIndex);

        paused ? collateralsTransferPauseFlags |= (uint24(1) << assetIndex) : collateralsTransferPauseFlags &= ~(uint24(1) << assetIndex);

        emit CollateralAssetTransferPauseAction(assetIndex, paused);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function deactivateCollateral(uint24 assetIndex) override external isValidAssetIndex(assetIndex) {
        if (msg.sender != CometMainInterface(address(this)).pauseGuardian()) revert OnlyPauseGuardian();
        if (isCollateralDeactivated(assetIndex)) revert CollateralIsDeactivated(assetIndex);

        // Mark collateral as deactivated
        deactivatedCollaterals |= (uint24(1) << assetIndex);
        emit CollateralDeactivated(assetIndex);
        
        // Pause supply of this collateral
        collateralsSupplyPauseFlags |= (uint24(1) << assetIndex);
        emit CollateralAssetSupplyPauseAction(assetIndex, true);
        
        // Pause transfer of this collateral
        collateralsTransferPauseFlags |= (uint24(1) << assetIndex);
        emit CollateralAssetTransferPauseAction(assetIndex, true);
    }

    /**
     * @inheritdoc CometExtInterface
     */
    function activateCollateral(uint24 assetIndex) override external isValidAssetIndex(assetIndex) {
        if (msg.sender != CometMainInterface(address(this)).governor()) revert OnlyGovernor();
        if ((deactivatedCollaterals & (uint24(1) << assetIndex) != 0) == false) revert CollateralIsActivated(assetIndex);

        // Mark collateral as activated
        deactivatedCollaterals &= ~(uint24(1) << assetIndex);
        emit CollateralActivated(assetIndex);
        
        // Unpause supply of this collateral
        collateralsSupplyPauseFlags &= ~(uint24(1) << assetIndex);
        emit CollateralAssetSupplyPauseAction(assetIndex, false);

        // Unpause transfer of this collateral
        collateralsTransferPauseFlags &= ~(uint24(1) << assetIndex);
        emit CollateralAssetTransferPauseAction(assetIndex, false);
    }
}