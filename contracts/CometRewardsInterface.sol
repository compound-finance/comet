// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @title Compound's CometRewards Interface
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
abstract contract CometRewardsInterface {
    struct RewardOwed {
        address token;
        uint owed;
    }

    function getRewardOwed(address comet, address account) virtual external returns (RewardOwed memory);
    function claim(address comet, address src, bool shouldAccrue) virtual external;
    function claimTo(address comet, address src, address to, bool shouldAccrue) virtual external;
}
