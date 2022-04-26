// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity 0.8.13;

import "../ERC20.sol";

contract Fauceteer {
    /// @notice Mapping of user address -> asset address -> last time the user
    /// received that asset
    mapping(address => mapping(address => uint)) public lastReceived;

    /* errors */
    error TransferFailed();

    function drip(ERC20 token) public {
        uint balance = token.balanceOf(address(this));
        // require(balance > 0, "Fauceteer is empty");

        bool success = ERC20(token).transfer(msg.sender, balance / 10000); // 0.01%
        if (!success) revert TransferFailed();
    }
}