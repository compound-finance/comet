// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./BaseBulker.sol";
import "../IWstETH.sol";

/**
 * @title Compound's Bulker contract for Ethereum mainnet
 * @notice Executes multiple Comet-related actions in a single transaction
 * @author Compound
 */
contract MainnetBulker is BaseBulker {
    /** General configuration constants **/

    /// @notice The address of Lido staked ETH
    address public immutable steth;

    /// @notice The address of Lido wrapped staked ETH
    address public immutable wsteth;

    /** Actions **/

    /// @notice The action for supplying staked ETH to Comet
    bytes32 public constant ACTION_SUPPLY_STETH = "ACTION_SUPPLY_STETH";

    /// @notice The action for withdrawing staked ETH from Comet
    bytes32 public constant ACTION_WITHDRAW_STETH = "ACTION_WITHDRAW_STETH";

    /** Custom errors **/

    error UnsupportedBaseAsset();

    /**
     * @notice Construct a new MainnetBulker instance
     * @param admin_ The admin of the Bulker contract
     * @param weth_ The address of wrapped ETH
     * @param wsteth_ The address of Lido wrapped staked ETH
     **/
    constructor(
        address admin_,
        address payable weth_,
        address wsteth_
    ) BaseBulker(admin_, weth_) {
        wsteth = wsteth_;
        steth = IWstETH(wsteth_).stETH();
    }

    /**
     * @notice Handles actions specific to the Ethereum mainnet version of Bulker, specifically supplying and withdrawing stETH
     */
    function handleAction(bytes32 action, bytes calldata data) override internal {
        if (action == ACTION_SUPPLY_STETH) {
            (address comet, address to, uint stETHAmount) = abi.decode(data, (address, address, uint));
            supplyStEthTo(comet, to, stETHAmount);
        } else if (action == ACTION_WITHDRAW_STETH) {
            (address comet, address to, uint wstETHAmount) = abi.decode(data, (address, address, uint));
            withdrawStEthTo(comet, to, wstETHAmount);
        } else {
            revert UnhandledAction();
        }
    }

    /**
     * @notice Wraps stETH to wstETH and supplies to a user in Comet
     * @dev Note: This contract must have permission to manage msg.sender's Comet account
     * @dev Note: wstETH base asset is NOT supported
     */
    function supplyStEthTo(address comet, address to, uint stETHAmount) internal {
        if (CometInterface(comet).baseToken() == wsteth) revert UnsupportedBaseAsset();

        doTransferIn(steth, msg.sender, stETHAmount);
        ERC20(steth).approve(wsteth, stETHAmount);
        uint wstETHAmount = IWstETH(wsteth).wrap(stETHAmount);
        ERC20(wsteth).approve(comet, wstETHAmount);
        CometInterface(comet).supplyFrom(address(this), to, wsteth, wstETHAmount);
    }

    /**
     * @notice Withdraws wstETH from Comet, unwraps it to stETH, and transfers it to a user
     * @dev Note: This contract must have permission to manage msg.sender's Comet account
     * @dev Note: wstETH base asset is NOT supported
     * @dev Note: Supports `amount` of `uint256.max` to withdraw all wstETH from Comet
     */
    function withdrawStEthTo(address comet, address to, uint stETHAmount) internal {
        if (CometInterface(comet).baseToken() == wsteth) revert UnsupportedBaseAsset();

        uint wstETHAmount = stETHAmount == type(uint256).max
            ? CometInterface(comet).collateralBalanceOf(msg.sender, wsteth)
            : IWstETH(wsteth).getWstETHByStETH(stETHAmount);
        CometInterface(comet).withdrawFrom(msg.sender, address(this), wsteth, wstETHAmount);
        uint unwrappedStETHAmount = IWstETH(wsteth).unwrap(wstETHAmount);
        doTransferOut(steth, to, unwrappedStETHAmount);
    }
}