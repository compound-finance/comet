// SPDX-License-Identifier: XXX
pragma solidity ^0.8.11;

import "./../ERC20.sol";
import "./../Comet.sol";
import "./FaucetToken.sol";

/**
 * @title Malicious ERC20 token
 * @dev FaucetToken that attempts reentrancy attacks
 */
contract EvilToken is FaucetToken {
    enum ReentryAttack{
        TRANSFER_FROM,
        WITHDRAW
    }
    ReentryAttack public reentryAttack;

    constructor(
        uint256 _initialAmount,
        string memory _tokenName,
        uint8 _decimalUnits,
        string memory _tokenSymbol,
        ReentryAttack _reentryAttack
    ) FaucetToken(_initialAmount, _tokenName, _decimalUnits, _tokenSymbol) {
        reentryAttack = _reentryAttack;
    }

    function transfer(address dst, uint256 amount) external override returns (bool) {
        if (reentryAttack == ReentryAttack.TRANSFER_FROM) {
            Comet(payable(msg.sender)).transferFrom(dst, address(this), 1e6);
        } else {
            revert("invalid reentry attack");
        }
        return true;
    }
}