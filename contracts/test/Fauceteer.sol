// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity 0.8.13;

import "../ERC20.sol";

contract Fauceteer {
    /// @notice Mapping of user address -> asset address -> last time the user
    /// received that asset
    mapping(address => mapping(address => uint)) public lastReceived;

    /* errors */
    error BalanceTooLow();
    error RequestedTooFrequently();
    error TransferFailed();

    function drip(address token) public {
        uint balance = ERC20(token).balanceOf(address(this));
        if (balance <= 0) revert BalanceTooLow();

        if (block.timestamp - lastReceived[msg.sender][token] < 1 days) revert RequestedTooFrequently();

        bool success = ERC20(token).transfer(msg.sender, balance / 10000); // 0.01%
        if (!success) revert TransferFailed();

        lastReceived[msg.sender][token] = block.timestamp;
    }
}