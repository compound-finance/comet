// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../vendor/canonical-weth/contracts/WETH9.sol";

/**
 * @title The faucet WETH Test Token
 * @author Compound
 * @notice A simple test token that lets anyone get more of it.
 */
contract FaucetWETH is WETH9 {
    constructor(uint256 _initialAmount, string memory _tokenName, uint8 _decimalUnits, string memory _tokenSymbol) WETH9() {}

    function allocateTo(address _owner, uint256 value) public {
        balanceOf[_owner] += value;
        emit Transfer(address(this), _owner, value);
    }
}