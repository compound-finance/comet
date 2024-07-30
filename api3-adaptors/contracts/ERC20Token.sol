// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Token is ERC20 {
    constructor(string memory TokenName, string memory TokenSymbol) ERC20(TokenName, TokenSymbol) {
        _mint(msg.sender, 100000000 * 10 ** decimals()); // Mint 100,000,000 tokens with 18 decimals
    }
}