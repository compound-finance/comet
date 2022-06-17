// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.13;

import "./CometInterface.sol";
import "./IWETH9.sol";

contract Bulker {
    /** General configuration constants **/
    address payable public immutable weth;
    address public immutable comet;
    address public immutable baseToken;

    /** Actions **/
    uint public constant ACTION_SUPPLY_ASSET = 1;
    uint public constant ACTION_SUPPLY_ETH = 2;
    uint public constant ACTION_TRANSFER_ASSET = 3;
    uint public constant ACTION_WITHDRAW_ASSET = 4;
    uint public constant ACTION_WITHDRAW_ETH = 5;

    /** Custom errors **/
    error InvalidArgument();
    error FailedToSendEther();

    constructor(address comet_, address payable weth_) {
        comet = comet_;
        weth = weth_;
        baseToken = CometInterface(comet_).baseToken();
    }

    /**
     * @notice Fallback for receiving ether. Needed for ACTION_WITHDRAW_ETH.
     */
    receive() external payable {}

    /**
     * @notice Executes a list of actions in order
     * @param actions The list of actions to execute in order
     * @param data The list of calldata to use for each action
     */
    function invoke(uint[] calldata actions, bytes[] calldata data) external payable {
        if (actions.length != data.length) revert InvalidArgument();

        uint unusedEth = msg.value;
        uint numActions = actions.length;
        for (uint i = 0; i < numActions; ) {
            uint action = actions[i];
            if (action == ACTION_SUPPLY_ASSET) {
                (address to, address asset, uint amount) = abi.decode(data[i], (address, address, uint));
                supplyTo(to, asset, amount);
            } else if (action == ACTION_SUPPLY_ETH) {
                (address to, uint amount) = abi.decode(data[i], (address, uint));
                unusedEth -= amount;
                supplyEthTo(to, amount);
            } else if (action == ACTION_TRANSFER_ASSET) {
                (address to, address asset, uint amount) = abi.decode(data[i], (address, address, uint));
                transferTo(to, asset, amount);
            } else if (action == ACTION_WITHDRAW_ASSET) {
                (address to, address asset, uint amount) = abi.decode(data[i], (address, address, uint));
                withdrawTo(to, asset, amount);
            } else if (action == ACTION_WITHDRAW_ETH) {
                (address to, uint amount) = abi.decode(data[i], (address, uint));
                withdrawEthTo(to, amount);
            }
            unchecked { ++i; }
        }

        // Refund unused ETH back to msg.sender
        if (unusedEth > 0) {
            (bool success, ) = msg.sender.call{ value: unusedEth }("");
            if (!success) revert FailedToSendEther();
        }
    }

    /**
     * @notice Supplies an asset to a user in Comet
     */
    function supplyTo(address to, address asset, uint amount) internal {
        CometInterface(comet).supplyFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Wraps ETH and supplies WETH to a user in Comet
     */
    function supplyEthTo(address to, uint amount) internal {
        IWETH9(weth).deposit{ value: amount }();
        IWETH9(weth).approve(comet, amount);
        CometInterface(comet).supplyFrom(address(this), to, weth, amount);
    }

    /**
     * @notice Transfers an asset to a user in Comet
     */
    function transferTo(address to, address asset, uint amount) internal {
        amount = getAmount(asset, amount);
        CometInterface(comet).transferAssetFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws an asset to a user in Comet
     */
    function withdrawTo(address to, address asset, uint amount) internal {
        amount = getAmount(asset, amount);
        CometInterface(comet).withdrawFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws WETH from Comet to a user after unwrapping it to ETH
     */
    function withdrawEthTo(address to, uint amount) internal {
        amount = getAmount(weth, amount);
        CometInterface(comet).withdrawFrom(msg.sender, address(this), weth, amount);
        IWETH9(weth).withdraw(amount);
        (bool success, ) = to.call{ value: amount }("");
        if (!success) revert FailedToSendEther();
    }

    /**
     * @notice Handles the max transfer/withdraw case so that no dust is left in the protocol.
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
