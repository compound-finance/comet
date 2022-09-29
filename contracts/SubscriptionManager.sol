// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

contract SubscriptionManager {
    address public admin;

    struct SubscriptionPlan {
        uint id;
        uint ethPricePerYear;
        address developer;
        bool isActive;
    }

    uint256 public subscriptionPlanIdCounter;

    enum UserSubscriptionStatus {
        NotSubscribed,
        Active,
        Expired
    }

    struct UserSubscription {
        uint paymentAccrualTimestamp;
        uint ethBalance;
    }

    // user address -> app id -> UserSubscription
    mapping(address => mapping(uint => UserSubscription)) public userSubscriptions;

    // app id -> SubscriptionPlan
    mapping(uint => SubscriptionPlan) public subscriptionPlans;

    constructor(address admin_) {
        admin = admin_; // or just use msg.sender?
    }

    // admin reset subscription

    // create subscription plan
    function createSubscriptionPlan(uint ethPricePerYear) public returns (SubscriptionPlan memory) {
        uint id = subscriptionPlanIdCounter++;

        SubscriptionPlan memory newSubscriptionPlan = SubscriptionPlan({
            id: id,
            ethPricePerYear: ethPricePerYear,
            developer: msg.sender,
            isActive: true
        });

        subscriptionPlans[id] = newSubscriptionPlan;

        return newSubscriptionPlan;
    }

    // subscribe to app
    function subscribeToPlan(uint subscriptionPlanId) public payable {
        // XXX handle re-subscribing to an existing subscription
        userSubscriptions[msg.sender][subscriptionPlanId] = UserSubscription({
            paymentAccrualTimestamp: block.timestamp,
            ethBalance: msg.value
        });
    }

    function subscriptionFundedUntil(address userAddress, uint subscriptionPlanId) internal returns (uint) {
        UserSubscription memory userSubscription = userSubscriptions[userAddress][subscriptionPlanId];
        SubscriptionPlan memory subscriptionPlan = subscriptionPlans[subscriptionPlanId];

        uint pricePerSecond = subscriptionPlan.ethPricePerYear / (365 * 24 * 60 * 60);

        uint secondsCovered = userSubscription.ethBalance / pricePerSecond;

        return userSubscription.paymentAccrualTimestamp + secondsCovered;
    }

    function userSubscriptionStatus(address userAddress, uint subscriptionPlanId) external view returns (UserSubscriptionStatus, uint) {
        UserSubscription memory userSubscription = userSubscriptions[userAddress][subscriptionPlanId];

        uint fundedUntil = subscriptionFundedUntil(userAddress, subscriptionPlanId);

        if (userSubscription.paymentAccrualTimestamp == 0) {
            return (UserSubscriptionStatus.NotSubscribed, 0);
        } else if (fundedUntil > block.timestamp) {
            return (UserSubscriptionStatus.Active, fundedUntil);
        } else {
            return (UserSubscriptionStatus.Expired, fundedUntil);
        }
    }

    // XXX developer withdraw
    //   update paymentAccrualTimestamp
    //   update ethBalance

    // XXX user withdraw
    //   delete userSubscription
    //   pay out both developer and user

    // XXX cancel subscription

    // XXX developer cancel subscription plan?
}