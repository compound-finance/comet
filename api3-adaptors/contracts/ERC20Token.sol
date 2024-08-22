// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Token is ERC20 {
    uint8 private _decimals;
    constructor(string memory TokenName, string memory TokenSymbol, uint8 TokenDecimals) ERC20(TokenName, TokenSymbol) {
        _decimals = TokenDecimals;
        _mint(msg.sender, 100000000 * 10 ** TokenDecimals);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}