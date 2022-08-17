// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometInterface.sol";
import "./ERC20.sol";
import "./IWETH9.sol";

interface IClaimable {
    function claim(address comet, address src, bool shouldAccrue) external;

    function claimTo(address comet, address src, address to, bool shouldAccrue) external;
}

contract Bulker {
    /** General configuration constants **/
    address public immutable admin;
    address public immutable comet;
    address public immutable rewards;
    address payable public immutable weth;
    address public immutable baseToken;

    /** Actions **/
    uint public constant ACTION_SUPPLY_ASSET = 1;
    uint public constant ACTION_SUPPLY_ETH = 2;
    uint public constant ACTION_TRANSFER_ASSET = 3;
    uint public constant ACTION_WITHDRAW_ASSET = 4;
    uint public constant ACTION_WITHDRAW_ETH = 5;
    uint public constant ACTION_CLAIM_REWARD = 6;

    /** Custom errors **/
    error InvalidArgument();
    error FailedToSendEther();
    error Unauthorized();

    constructor(address admin_, address comet_, address rewards_, address payable weth_) {
        admin = admin_;
        comet = comet_;
        rewards = rewards_;
        weth = weth_;
        baseToken = CometInterface(comet_).baseToken();
    }

    /**
     * @notice Fallback for receiving ether. Needed for ACTION_WITHDRAW_ETH.
     */
    receive() external payable {}

    /**
     * @notice A public function to sweep accidental ERC-20 transfers to this contract. Tokens are sent to admin (Timelock)
     * @param recipient The address that will receive the swept funds
     * @param asset The address of the ERC-20 token to sweep
     */
    function sweepToken(address recipient, ERC20 asset) external {
        if (msg.sender != admin) revert Unauthorized();

        uint256 balance = asset.balanceOf(address(this));
        asset.transfer(recipient, balance);
    }

    /**
     * @notice A public function to sweep accidental ETH transfers to this contract. Tokens are sent to admin (Timelock)
     * @param recipient The address that will receive the swept funds
     */
    function sweepEth(address recipient) external {
        if (msg.sender != admin) revert Unauthorized();

        uint256 balance = address(this).balance;
        (bool success, ) = recipient.call{ value: balance }("");
        if (!success) revert FailedToSendEther();
    }

    /**
     * @notice Executes a list of actions in order
     * @param actions The list of actions to execute in order
     * @param data The list of calldata to use for each action
     */
    function invoke(uint[] calldata actions, bytes[] calldata data) external payable {
        if (actions.length != data.length) revert InvalidArgument();

        uint unusedEth = msg.value;
        for (uint i = 0; i < actions.length; ) {
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
            } else if (action == ACTION_CLAIM_REWARD) {
                (address src, bool shouldAccrue) = abi.decode(data[i], (address, bool));
                claimReward(src, shouldAccrue);
            }
            unchecked { i++; }
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
        CometInterface(comet).transferAssetFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws an asset to a user in Comet
     */
    function withdrawTo(address to, address asset, uint amount) internal {
        CometInterface(comet).withdrawFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws WETH from Comet to a user after unwrapping it to ETH
     */
    function withdrawEthTo(address to, uint amount) internal {
        CometInterface(comet).withdrawFrom(msg.sender, address(this), weth, amount);
        IWETH9(weth).withdraw(amount);
        (bool success, ) = to.call{ value: amount }("");
        if (!success) revert FailedToSendEther();
    }

    /**
     * @notice Claim reward for a user
     */
    function claimReward(address src, bool shouldAccrue) internal {
        IClaimable(rewards).claim(comet, src, shouldAccrue);
    }
}
