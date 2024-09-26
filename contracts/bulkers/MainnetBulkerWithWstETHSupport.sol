// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./BaseBulker.sol";
import "../IWstETH.sol";

/**
 * @title Compound's Bulker contract for Ethereum mainnet
 * @notice Executes multiple Comet-related actions in a single transaction
 * @author Compound
 */
contract MainnetBulkerWithWstETHSupport is BaseBulker {
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
     * @dev Note: Supports `stETHAmount` of `uint256.max` to fully repay the wstETH debt
     * @dev Note: Only for the cwstETHv3 market
     */
    function supplyStEthTo(address comet, address to, uint stETHAmount) internal {
        if(CometInterface(comet).baseToken() != wsteth) revert UnsupportedBaseAsset();
        uint256 _stETHAmount = stETHAmount == type(uint256).max
            ? IWstETH(wsteth).getStETHByWstETH(CometInterface(comet).borrowBalanceOf(msg.sender))
            : stETHAmount;
        doTransferIn(steth, msg.sender, _stETHAmount);
        ERC20(steth).approve(wsteth, _stETHAmount);
        uint wstETHAmount = IWstETH(wsteth).wrap(_stETHAmount);
        ERC20(wsteth).approve(comet, wstETHAmount);
        CometInterface(comet).supplyFrom(address(this), to, wsteth, wstETHAmount);
    }

    /**
     * @notice Withdraws wstETH from Comet, unwraps it to stETH, and transfers it to a user
     * @dev Note: This contract must have permission to manage msg.sender's Comet account
     * @dev Note: Supports `amount` of `uint256.max` to withdraw all wstETH from Comet
     * @dev Note: Only for the cwstETHv3 market
     */
    function withdrawStEthTo(address comet, address to, uint stETHAmount) internal {
        if(CometInterface(comet).baseToken() != wsteth) revert UnsupportedBaseAsset();
        uint wstETHAmount = stETHAmount == type(uint256).max
            ? CometInterface(comet).balanceOf(msg.sender)
            : IWstETH(wsteth).getWstETHByStETH(stETHAmount);
        CometInterface(comet).withdrawFrom(msg.sender, address(this), wsteth, wstETHAmount);
        uint unwrappedStETHAmount = IWstETH(wsteth).unwrap(wstETHAmount);
        doTransferOut(steth, to, unwrappedStETHAmount);
    }
    
    /**
     * @notice Submits received ether to get stETH and wraps it to wstETH, received wstETH is transferred to Comet
     */
    function deposit(address comet) external payable {
        if(msg.sender != admin) revert Unauthorized();
        if(CometInterface(comet).baseToken() != wsteth) revert UnsupportedBaseAsset();
        (bool success, ) = payable(wsteth).call{value: msg.value}(new bytes(0));
        if(!success) revert TransferOutFailed();

        uint wstETHAmount = ERC20(wsteth).balanceOf(address(this));
        doTransferOut(wsteth, comet, wstETHAmount);
    }
}