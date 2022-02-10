// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometBase.sol";

contract CometAbsorber is CometBase {
    constructor(Configuration memory config) CometBase(config) {
        // empty
    }

    function absorb(address absorber, address[] calldata accounts) external {
        uint startGas = gasleft();
        for (uint i = 0; i < accounts.length; i++) {
            absorbInternal(accounts[i]);
        }
        uint gasUsed = startGas - gasleft();

        LiquidatorPoints memory points = liquidatorPoints[absorber];
        points.numAbsorbs++;
        points.numAbsorbed += safe64(accounts.length);
        points.approxSpend += safe128(gasUsed * block.basefee);
        liquidatorPoints[absorber] = points;
    }

    /**
     * @dev Transfer user's collateral and debt to the protocol itself.
     */
    function absorbInternal(address account) internal {
        require(isLiquidatable(account), "account is not underwater");

        TotalsBasic memory totals = totalsBasic;
        totals = accrue(totals);

        UserBasic memory accountUser = userBasic[account];
        int104 oldBalance = presentValue(totals, accountUser.principal);
        uint16 assetsIn = accountUser.assetsIn;

        uint basePrice = getPrice(baseTokenPriceFeed);
        uint deltaValue = 0;

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                AssetInfo memory assetInfo = getAssetInfo(i);
                address asset = assetInfo.asset;
                uint128 seizeAmount = userCollateral[account][asset].balance;
                if (seizeAmount > 0) {
                    userCollateral[account][asset].balance = 0;
                    userCollateral[address(this)][asset].balance += seizeAmount;

                    uint value = mulPrice(seizeAmount, getPrice(assetInfo.priceFeed), assetInfo.scale);
                    deltaValue += mulFactor(value, assetInfo.liquidationFactor);
                }
            }
        }

        uint104 deltaBalance = safe104(divPrice(deltaValue, basePrice, baseScale));
        int104 newBalance = oldBalance + signed104(deltaBalance);
        // New balance will not be negative, all excess debt absorbed by reserves
        newBalance = newBalance < 0 ? int104(0) : newBalance;
        updateBaseBalance(totals, account, accountUser, principalValue(totals, newBalance));

        // Reserves are decreased by increasing total supply and decreasing borrows
        //  the amount of debt repaid by reserves is `newBalance - oldBalance`
        // Note: new balance must be non-negative due to the above thresholding
        totals.totalSupplyBase += principalValueSupply(totals, unsigned104(newBalance));
        // Note: old balance must be negative since the account is liquidatable
        totals.totalBorrowBase -= principalValueBorrow(totals, unsigned104(-oldBalance));

        totalsBasic = totals;
    }
}