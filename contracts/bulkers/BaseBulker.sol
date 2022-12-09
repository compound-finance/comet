// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../CometInterface.sol";
import "../ERC20.sol";
import "../IWETH9.sol";

interface IClaimable {
    function claim(address comet, address src, bool shouldAccrue) external;

    function claimTo(address comet, address src, address to, bool shouldAccrue) external;
}

contract BaseBulker {
    /** General configuration constants **/
    address public immutable admin;
    address payable public immutable wrappedNativeToken;

    /** Actions **/
    bytes32 public constant ACTION_SUPPLY_ASSET = "ACTION_SUPPLY_ASSET";
    bytes32 public constant ACTION_SUPPLY_NATIVE_TOKEN = "ACTION_SUPPLY_NATIVE_TOKEN";
    bytes32 public constant ACTION_TRANSFER_ASSET = "ACTION_TRANSFER_ASSET";
    bytes32 public constant ACTION_WITHDRAW_ASSET = "ACTION_WITHDRAW_ASSET";
    bytes32 public constant ACTION_WITHDRAW_NATIVE_TOKEN = "ACTION_WITHDRAW_NATIVE_TOKEN";
    bytes32 public constant ACTION_CLAIM_REWARD = "ACTION_CLAIM_REWARD";

    /** Custom errors **/
    error InvalidArgument();
    error FailedToSendNativeToken();
    error Unauthorized();
    error UnhandledAction();

    constructor(address admin_, address payable wrappedNativeToken_) {
        admin = admin_;
        wrappedNativeToken = wrappedNativeToken_;
    }

    /**
     * @notice Fallback for receiving native token. Needed for ACTION_WITHDRAW_NATIVE_TOKEN.
     */
    receive() external payable {}

    /**
     * @notice A public function to sweep accidental ERC-20 transfers to this contract. Tokens are sent to admin (Timelock)
     * @dev Note: Make sure to check that the asset being swept out is not malicious.
     * @param recipient The address that will receive the swept funds
     * @param asset The address of the ERC-20 token to sweep
     */
    function sweepToken(address recipient, ERC20 asset) external {
        if (msg.sender != admin) revert Unauthorized();

        uint256 balance = asset.balanceOf(address(this));
        asset.transfer(recipient, balance);
    }

    /**
     * @notice A public function to sweep accidental native token transfers to this contract. Tokens are sent to admin (Timelock)
     * @param recipient The address that will receive the swept funds
     */
    function sweepNativeToken(address recipient) external {
        if (msg.sender != admin) revert Unauthorized();

        uint256 balance = address(this).balance;
        (bool success, ) = recipient.call{ value: balance }("");
        if (!success) revert FailedToSendNativeToken();
    }

    /**
     * @notice Executes a list of actions in order
     * @param actions The list of actions to execute in order
     * @param data The list of calldata to use for each action
     */
    function invoke(bytes32[] calldata actions, bytes[] calldata data) external payable {
        if (actions.length != data.length) revert InvalidArgument();

        uint unusedNativeToken = msg.value;
        for (uint i = 0; i < actions.length; ) {
            bytes32 action = actions[i];
            if (action == ACTION_SUPPLY_ASSET) {
                (address comet, address to, address asset, uint amount) = abi.decode(data[i], (address, address, address, uint));
                supplyTo(comet, to, asset, amount);
            } else if (action == ACTION_SUPPLY_NATIVE_TOKEN) {
                (address comet, address to, uint amount) = abi.decode(data[i], (address, address, uint));
                unusedNativeToken -= amount;
                supplyNativeTokenTo(comet, to, amount);
            } else if (action == ACTION_TRANSFER_ASSET) {
                (address comet, address to, address asset, uint amount) = abi.decode(data[i], (address, address, address, uint));
                transferTo(comet, to, asset, amount);
            } else if (action == ACTION_WITHDRAW_ASSET) {
                (address comet, address to, address asset, uint amount) = abi.decode(data[i], (address, address, address, uint));
                withdrawTo(comet, to, asset, amount);
            } else if (action == ACTION_WITHDRAW_NATIVE_TOKEN) {
                (address comet, address to, uint amount) = abi.decode(data[i], (address, address, uint));
                withdrawNativeTokenTo(comet, to, amount);
            } else if (action == ACTION_CLAIM_REWARD) {
                (address comet, address rewards, address src, bool shouldAccrue) = abi.decode(data[i], (address, address, address, bool));
                claimReward(comet, rewards, src, shouldAccrue);
            } else {
                handleAction(action, data[i]);
            }
            unchecked { i++; }
        }

        // Refund unused ETH back to msg.sender
        if (unusedNativeToken > 0) {
            (bool success, ) = msg.sender.call{ value: unusedNativeToken }("");
            if (!success) revert FailedToSendNativeToken();
        }
    }

    function handleAction(bytes32 action, bytes calldata data) virtual internal {
        revert UnhandledAction();
    }

    /**
     * @notice Supplies an asset to a user in Comet
     */
    function supplyTo(address comet, address to, address asset, uint amount) internal {
        CometInterface(comet).supplyFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Wraps native token and supplies wrapped native token to a user in Comet
     */
    function supplyNativeTokenTo(address comet, address to, uint amount) internal {
        IWETH9(wrappedNativeToken).deposit{ value: amount }();
        IWETH9(wrappedNativeToken).approve(comet, amount);
        CometInterface(comet).supplyFrom(address(this), to, wrappedNativeToken, amount);
    }

    /**
     * @notice Transfers an asset to a user in Comet
     */
    function transferTo(address comet, address to, address asset, uint amount) internal {
        CometInterface(comet).transferAssetFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws an asset to a user in Comet
     */
    function withdrawTo(address comet, address to, address asset, uint amount) internal {
        CometInterface(comet).withdrawFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws wrapped native token from Comet to a user after unwrapping it to native token
     */
    function withdrawNativeTokenTo(address comet, address to, uint amount) internal {
        CometInterface(comet).withdrawFrom(msg.sender, address(this), wrappedNativeToken, amount);
        IWETH9(wrappedNativeToken).withdraw(amount);
        (bool success, ) = to.call{ value: amount }("");
        if (!success) revert FailedToSendNativeToken();
    }

    /**
     * @notice Claim reward for a user
     */
    function claimReward(address comet, address rewards, address src, bool shouldAccrue) internal {
        IClaimable(rewards).claim(comet, src, shouldAccrue);
    }
}
