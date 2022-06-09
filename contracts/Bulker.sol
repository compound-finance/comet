// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.13;

import "./CometInterface.sol";
import "./IWETH9.sol";
import "./ERC20.sol";

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata) external returns (uint256);
}

contract Bulker {
    /** General configuration constants **/
    address payable public immutable weth;
    address public immutable comet;
    address public immutable baseToken;

    /** Actions **/
    uint256 public constant ACTION_SUPPLY_ASSET = 1;
    uint256 public constant ACTION_SUPPLY_ETH = 2;
    uint256 public constant ACTION_TRANSFER_ASSET = 3;
    uint256 public constant ACTION_WITHDRAW_ASSET = 4;
    uint256 public constant ACTION_WITHDRAW_AND_SWAP_ASSET = 5;
    uint256 public constant ACTION_WITHDRAW_ETH = 6;

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
    function invoke(uint256[] calldata actions, bytes[] calldata data) external payable {
        if (actions.length != data.length) revert InvalidArgument();

        uint256 unusedEth = msg.value;
        for (uint256 i = 0; i < actions.length; ) {
            uint256 action = actions[i];
            if (action == ACTION_SUPPLY_ASSET) {
                (address to, address asset, uint256 amount) = abi.decode(
                    data[i],
                    (address, address, uint256)
                );
                supplyTo(to, asset, amount);
            } else if (action == ACTION_SUPPLY_ETH) {
                (address to, uint256 amount) = abi.decode(data[i], (address, uint256));
                unusedEth -= amount;
                supplyEthTo(to, amount);
            } else if (action == ACTION_TRANSFER_ASSET) {
                (address to, address asset, uint256 amount) = abi.decode(
                    data[i],
                    (address, address, uint256)
                );
                transferTo(to, asset, amount);
            } else if (action == ACTION_WITHDRAW_ASSET) {
                (address to, address asset, uint256 amount) = abi.decode(
                    data[i],
                    (address, address, uint256)
                );
                withdrawTo(to, asset, amount);
            } else if (action == ACTION_WITHDRAW_AND_SWAP_ASSET) {
                (address to, uint256 amount) = abi.decode(data[i], (address, uint256));
                withdrawAndSwapTo(address(this), amount);
            } else if (action == ACTION_WITHDRAW_ETH) {
                (address to, uint256 amount) = abi.decode(data[i], (address, uint256));
                withdrawEthTo(to, amount);
            }
            unchecked {
                i++;
            }
        }

        // Refund unused ETH back to msg.sender
        if (unusedEth > 0) {
            (bool success, ) = msg.sender.call{value: unusedEth}("");
            if (!success) revert FailedToSendEther();
        }
    }

    /**
     * @notice Supplies an asset to a user in Comet
     */
    function supplyTo(
        address to,
        address asset,
        uint256 amount
    ) internal {
        CometInterface(comet).supplyFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Wraps ETH and supplies WETH to a user in Comet
     */
    function supplyEthTo(address to, uint256 amount) internal {
        IWETH9(weth).deposit{value: amount}();
        IWETH9(weth).approve(comet, amount);
        CometInterface(comet).supplyFrom(address(this), to, weth, amount);
    }

    /**
     * @notice Transfers an asset to a user in Comet
     */
    function transferTo(
        address to,
        address asset,
        uint256 amount
    ) internal {
        amount = getAmount(asset, amount);
        CometInterface(comet).transferAssetFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws an asset to a user in Comet
     */
    function withdrawTo(
        address to,
        address asset,
        uint256 amount
    ) internal {
        amount = getAmount(asset, amount);
        CometInterface(comet).withdrawFrom(msg.sender, to, asset, amount);
    }

    /**
     * @notice Withdraws an asset to a user in Comet
     */
    function withdrawAndSwapTo(address to, uint256 amount) internal {
        amount = getAmount(baseToken, amount);
        CometInterface(comet).withdrawFrom(msg.sender, address(this), baseToken, amount);
        address pool = address(0xC9A07C2371113fc7C63e357382456d49A60bE329);
        address dai = address(0x4F96Fe3b7A6Cf9725f59d353F723c1bDb64CA6Aa);
        ERC20(baseToken).approve(pool, amount);


        // Naively set amountOutMinimum to 0. In production, use an oracle or other data source to choose a safer value for amountOutMinimum.
        // We also set the sqrtPriceLimitx96 to be 0 to ensure we swap our exact input amount.
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: baseToken,
            tokenOut: dai,
            fee: 500,
            recipient: msg.sender,
            deadline: block.timestamp,
            amountIn: amount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: type(uint160).max
        });

        uint amountOut = ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564).exactInputSingle(
            params
        );
        ERC20(0xC9A07C2371113fc7C63e357382456d49A60bE329).transfer(msg.sender, amountOut);
    }

    /**
     * @notice Withdraws WETH from Comet to a user after unwrapping it to ETH
     */
    function withdrawEthTo(address to, uint256 amount) internal {
        amount = getAmount(weth, amount);
        CometInterface(comet).withdrawFrom(msg.sender, address(this), weth, amount);
        IWETH9(weth).withdraw(amount);
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert FailedToSendEther();
    }

    /**
     * @notice Handles the max transfer/withdraw case so that no dust is left in the protocol.
     */
    function getAmount(address asset, uint256 amount) internal view returns (uint256) {
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
