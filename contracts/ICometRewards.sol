// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @dev Interface for interacting with the CometRewards contract
 */
interface ICometRewards {
    struct RewardOwed {
        address token;
        uint owed;
    }

    function setRewardConfig(address comet, address token) external;

    function withdrawToken(address token, address to, uint amount) external;

    function transferGovernor(address newGovernor) external;

    function getRewardOwed(address comet, address account) external returns (RewardOwed memory);

    function claim(address comet, address src, bool shouldAccrue) external;

    function claimTo(address comet, address src, address to, bool shouldAccrue) external;
}
