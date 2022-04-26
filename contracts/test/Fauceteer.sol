// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity 0.8.13;

import "../ERC20.sol";

contract Fauceteer {
    /// @notice Mapping of user address -> asset address -> last time the user
    /// received that asset
    mapping(address => mapping(address => uint)) public lastReceived;

    function drip(ERC20 token) public {

    }

}