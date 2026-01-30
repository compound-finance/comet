// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometCore.sol";

/**
 * @title Compound's Comet Ext Interface
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
abstract contract CometExtInterface is CometCore {
    error BadAmount();
    error BadNonce();
    error BadSignatory();
    error InvalidValueS();
    error InvalidValueV();
    error SignatureExpired();

    /**
     * @dev Error thrown when the caller is not the pause guardian or governor
     */
    error OnlyPauseGuardianOrGovernor();
    /**
     * @dev Error thrown when the offset status is already set
     * @param offset The offset that is already set
     * @param status The status of the offset
     */
    error OffsetStatusAlreadySet(uint24 offset, bool status);
    /**
     * @dev Error thrown when the collateral asset offset status is already set
     * @param offset The offset that is already set
     * @param assetIndex The index of the collateral asset
     * @param status The status of the offset
     */
    error CollateralAssetOffsetStatusAlreadySet(uint24 offset, uint24 assetIndex, bool status);
    /**
     * @dev Error thrown when the asset index is invalid
     */
    error InvalidAssetIndex();

    function allow(address manager, bool isAllowed) virtual external;
    function allowBySig(address owner, address manager, bool isAllowed, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) virtual external;

    /*//////////////////////////////////////////////////////////////
                             PAUSE CONTROL
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Pauses or unpauses the ability for lenders to withdraw their assets.
     * @param paused Whether to pause (`true`) or unpause (`false`) lenders' withdrawals.
     */
    function pauseLendersWithdraw(bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the ability for borrowers to withdraw their assets.
     * @param paused Whether to pause (`true`) or unpause (`false`) borrowers' withdrawals.
     */
    function pauseBorrowersWithdraw(bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the ability to withdraw collateral.
     * @param paused Whether to pause (`true`) or unpause (`false`) collateral withdrawals.
     */
    function pauseCollateralWithdraw(bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the ability to withdraw a specific collateral asset.
     * @param assetIndex The index of the collateral asset to pause/unpause.
     * @param paused Whether to pause (`true`) or unpause (`false`) withdrawals for the specified collateral asset.
     */
    function pauseCollateralAssetWithdraw(uint24 assetIndex, bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the supply of collateral.
     * @param paused Whether to pause (`true`) or unpause (`false`) collateral supply actions.
     */
    function pauseCollateralSupply(bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the supply of base assets.
     * @param paused Whether to pause (`true`) or unpause (`false`) base asset supply actions.
     */
    function pauseBaseSupply(bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the supply of a specific collateral asset.
     * @param assetIndex The index of the collateral asset to pause/unpause.
     * @param paused Whether to pause (`true`) or unpause (`false`) supply actions for the specified collateral asset.
     */
    function pauseCollateralAssetSupply(uint24 assetIndex, bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the ability for lenders to transfer their assets.
     * @param paused Whether to pause (`true`) or unpause (`false`) lenders' transfer actions.
     */
    function pauseLendersTransfer(bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the ability for borrowers to transfer their assets.
     * @param paused Whether to pause (`true`) or unpause (`false`) borrowers' transfer actions.
     */
    function pauseBorrowersTransfer(bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the ability to transfer collateral.
     * @param paused Whether to pause (`true`) or unpause (`false`) collateral transfer actions.
     */
    function pauseCollateralTransfer(bool paused) virtual external;
    /**
     * @notice Pauses or unpauses the ability to transfer a specific collateral asset.
     * @param assetIndex The index of the collateral asset to pause/unpause.
     * @param paused Whether to pause (`true`) or unpause (`false`) transfer actions for the specified collateral asset.
     */
    function pauseCollateralAssetTransfer(uint24 assetIndex, bool paused) virtual external;

    function collateralBalanceOf(address account, address asset) virtual external view returns (uint128);
    function baseTrackingAccrued(address account) virtual external view returns (uint64);

    function baseAccrualScale() virtual external view returns (uint64);
    function baseIndexScale() virtual external view returns (uint64);
    function factorScale() virtual external view returns (uint64);
    function priceScale() virtual external view returns (uint64);

    function maxAssets() virtual external view returns (uint8);

    function totalsBasic() virtual external view returns (TotalsBasic memory);

    function version() virtual external view returns (string memory);

    /**
      * ===== ERC20 interfaces =====
      * Does not include the following functions/events, which are defined in `CometMainInterface` instead:
      * - function decimals() virtual external view returns (uint8)
      * - function totalSupply() virtual external view returns (uint256)
      * - function transfer(address dst, uint amount) virtual external returns (bool)
      * - function transferFrom(address src, address dst, uint amount) virtual external returns (bool)
      * - function balanceOf(address owner) virtual external view returns (uint256)
      * - event Transfer(address indexed from, address indexed to, uint256 amount)
      */
    function name() virtual external view returns (string memory);
    function symbol() virtual external view returns (string memory);

    /**
      * @notice Approve `spender` to transfer up to `amount` from `src`
      * @dev This will overwrite the approval amount for `spender`
      *  and is subject to issues noted [here](https://eips.ethereum.org/EIPS/eip-20#approve)
      * @param spender The address of the account which may transfer tokens
      * @param amount The number of tokens that are approved (-1 means infinite)
      * @return Whether or not the approval succeeded
      */
    function approve(address spender, uint256 amount) virtual external returns (bool);

    /**
      * @notice Get the current allowance from `owner` for `spender`
      * @param owner The address of the account which owns the tokens to be spent
      * @param spender The address of the account which may transfer tokens
      * @return The number of tokens allowed to be spent (-1 means infinite)
      */
    function allowance(address owner, address spender) virtual external view returns (uint256);

    event Approval(address indexed owner, address indexed spender, uint256 amount);
    /**
     * @notice Emitted when the pause status for lenders' withdrawals is changed
     * @param lendersWithdrawPaused Whether lenders' withdrawals are now paused
     */
    event LendersWithdrawPauseAction(bool lendersWithdrawPaused);
    /**
     * @notice Emitted when the pause status for borrowers' withdrawals is changed
     * @param borrowersWithdrawPaused Whether borrowers' withdrawals are now paused
     */
    event BorrowersWithdrawPauseAction(bool borrowersWithdrawPaused);
    /**
     * @notice Emitted when the pause status for collateral withdrawals is changed
     * @param collateralWithdrawPaused Whether collateral withdrawals are now paused
     */
    event CollateralWithdrawPauseAction(bool collateralWithdrawPaused);
    /**
     * @notice Emitted when the pause status for a specific collateral asset's withdrawals is changed
     * @param assetIndex The index of the collateral asset
     * @param collateralAssetWithdrawPaused Whether withdrawals for this collateral asset are now paused
     */
    event CollateralAssetWithdrawPauseAction(uint24 assetIndex, bool collateralAssetWithdrawPaused);
    /**
     * @notice Emitted when the pause status for collateral supply is changed
     * @param collateralSupplyPaused Whether collateral supply is now paused
     */
    event CollateralSupplyPauseAction(bool collateralSupplyPaused);
    /**
     * @notice Emitted when the pause status for a specific collateral asset's supply is changed
     * @param assetIndex The index of the collateral asset
     * @param collateralAssetSupplyPaused Whether supply for this collateral asset is now paused
     */
    event CollateralAssetSupplyPauseAction(uint24 assetIndex, bool collateralAssetSupplyPaused);
    /**
     * @notice Emitted when the pause status for base supply is changed
     * @param baseSupplyPaused Whether base supply is now paused
     */
    event BaseSupplyPauseAction(bool baseSupplyPaused);
    /**
     * @notice Emitted when the pause status for lenders' transfers is changed
     * @param lendersTransferPaused Whether lenders' transfers are now paused
     */
    event LendersTransferPauseAction(bool lendersTransferPaused);
    /**
     * @notice Emitted when the pause status for borrowers' transfers is changed
     * @param borrowersTransferPaused Whether borrowers' transfers are now paused
     */
    event BorrowersTransferPauseAction(bool borrowersTransferPaused);
    /**
     * @notice Emitted when the pause status for collateral transfers is changed
     * @param collateralTransferPaused Whether collateral transfers are now paused
     */
    event CollateralTransferPauseAction(bool collateralTransferPaused);
    /**
     * @notice Emitted when the pause status for a specific collateral asset's transfers is changed
     * @param assetIndex The index of the collateral asset
     * @param collateralAssetTransferPaused Whether transfers for this collateral asset are now paused
     */
    event CollateralAssetTransferPauseAction(uint24 assetIndex, bool collateralAssetTransferPaused);
}