// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometInterface.sol";
import "./IWETH9.sol";

contract Bulker {
    /** General configuration constants **/
    address payable public immutable weth;
    address public immutable comet;
    address public immutable baseToken;

    /** Actions **/
    enum Action {
        SupplyAsset,
        SupplyEth,
        TransferAsset,
        WithdrawAsset,
        WithdrawEth
    }

    /** Custom errors **/
    error InvalidArgument();
    error FailedToSendEther();

    constructor(address comet_, address payable weth_) {
        comet = comet_;
        weth = weth_;
        baseToken = CometInterface(comet_).baseToken();
    }

    function invoke(Action[] calldata actions, bytes[] calldata data) external payable {
        if (actions.length != data.length) revert InvalidArgument();
        
        for (uint i = 0; i < actions.length; ) {
            Action action = actions[i];
            if (action == Action.SupplyAsset) {
                (address to, address asset, uint amount) = abi.decode(data[i], (address, address, uint));
                supplyTo(to, asset, amount);
            } else if (action == Action.SupplyEth) {
                (address to, uint amount) = abi.decode(data[i], (address, uint));
                supplyEthTo(to, amount);
            } else if (action == Action.TransferAsset) {
                (address to, address asset, uint amount) = abi.decode(data[i], (address, address, uint));
                transferTo(to, asset, amount);
            } else if (action == Action.WithdrawAsset) {
                (address to, address asset, uint amount) = abi.decode(data[i], (address, address, uint));
                withdrawTo(to, asset, amount);
            } else if (action == Action.WithdrawEth) {
                (address to, uint amount) = abi.decode(data[i], (address, uint));
                withdrawEthTo(to, amount);
            }
            unchecked { i++; }
        }
        // XXX refund unused ETH
    }

    function supplyTo(address to, address asset, uint amount) internal {
        CometInterface(comet).supplyFrom(msg.sender, to, asset, amount);
    }

    // XXX test that amount > msg.value fails
    // XXX test that multiple supplyEthTo with 2 x amount > msg.value fails. Also test that 2 x amount <= msg.value passes
    function supplyEthTo(address to, uint amount) internal {
        IWETH9(weth).deposit{ value: amount }();
        CometInterface(comet).supplyFrom(address(this), to, weth, amount);
    }

    function transferTo(address to, address asset, uint amount) internal {
        amount = getAmount(asset, amount);
        CometInterface(comet).transferAssetFrom(msg.sender, to, asset, amount);
    }

    function withdrawTo(address to, address asset, uint amount) internal {
        amount = getAmount(asset, amount);
        CometInterface(comet).withdrawFrom(msg.sender, to, asset, amount);
    }

    function withdrawEthTo(address to, uint amount) internal {
        amount = getAmount(weth, amount);
        CometInterface(comet).withdrawFrom(msg.sender, address(this), weth, amount);
        IWETH9(weth).withdraw(amount);
        (bool success, ) = to.call{ value: amount }("");
        if (!success) revert FailedToSendEther();
    }

    /**
     * @dev Handles the max transfer/withdraw case so that no dust is left in the protocol.
     */
    function getAmount(address asset, uint amount) internal view returns (uint) {
        if (amount == type(uint256).max) {
            if (asset == baseToken) {
                return CometInterface(comet).balanceOf(msg.sender);
            } else {
                return CometInterface(comet).collateralBalanceOf(msg.sender, asset);
            }
        }
        return amount;
    }
}
