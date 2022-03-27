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
    enum AttackType {
        TRANSFER_FROM,
        WITHDRAW_FROM
    }

    struct ReentryAttack {
        AttackType attackType;
        address asset;
        address recipient;
        uint amount;
    }

    ReentryAttack public attack;

    constructor(
        uint256 _initialAmount,
        string memory _tokenName,
        uint8 _decimalUnits,
        string memory _tokenSymbol
    ) FaucetToken(_initialAmount, _tokenName, _decimalUnits, _tokenSymbol) {
        attack = ReentryAttack({
            attackType: AttackType.TRANSFER_FROM,
            asset: address(this),
            recipient: address(this),
            amount: 1e6
        });
    }

    function getAttack() external view returns (ReentryAttack memory) {
        return attack;
    }

    function setAttack(ReentryAttack memory attack_) external {
        attack = attack_;
    }

    function transfer(address dst, uint256 amount) external override returns (bool) {
        ReentryAttack memory reentryAttack = attack;
        if (reentryAttack.attackType == AttackType.TRANSFER_FROM) {
            Comet(payable(msg.sender)).transferFrom(
                dst,
                reentryAttack.recipient,
                reentryAttack.amount
            );
        } else if (reentryAttack.attackType == AttackType.WITHDRAW_FROM) {
            Comet(payable(msg.sender)).withdrawFrom(
                dst,
                reentryAttack.recipient,
                reentryAttack.asset,
                reentryAttack.amount
            );
        } else {
            revert("invalid reentry attack");
        }
        return true;
    }
}