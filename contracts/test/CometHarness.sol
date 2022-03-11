// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../Comet.sol";

contract CometHarness is Comet {
    uint public nowOverride;

    constructor(Configuration memory config) Comet(config) {}

    function getNowInternal() override internal view returns (uint40) {
        return nowOverride > 0 ? uint40(nowOverride) : super.getNowInternal();
    }

    function getNow() public view returns (uint40) {
        return getNowInternal();
    }

    function setNow(uint now_) external {
        nowOverride = now_;
    }

    function setTotalsBasic(TotalsBasic memory totals) external {
        baseSupplyIndex = totals.baseSupplyIndex;
        baseBorrowIndex = totals.baseBorrowIndex;
        trackingSupplyIndex = totals.trackingSupplyIndex;
        trackingBorrowIndex = totals.trackingBorrowIndex;
        totalSupplyBase = totals.totalSupplyBase;
        totalBorrowBase = totals.totalBorrowBase;
        lastAccrualTime = totals.lastAccrualTime;
    }

    function setTotalsCollateral(address asset, TotalsCollateral memory totals) external {
        totalsCollateral[asset] = totals;
    }

    function setBasePrincipal(address account, int104 principal) external {
        userBasic[account].principal = principal;
    }

    function setCollateralBalance(address account, address asset, uint128 balance) external {
        uint128 oldBalance = userCollateral[account][asset].balance;
        userCollateral[account][asset].balance = balance;
        updateAssetsIn(account, asset, oldBalance, balance);
    }

    function updateAssetsInExternal(
        address account,
        address asset,
        uint128 initialUserBalance,
        uint128 finalUserBalance
    ) external {
        updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    }

    function getAssetInfo(uint8 i) external view returns (AssetInfo memory) {
        if (i >= numAssets) revert BadAsset();
        return AssetInfo({
            offset: i,
            asset: getAssetAddress(i),
            priceFeed: getAssetPriceFeed(i),
            scale: getAssetScale(i),
            borrowCollateralFactor: getAssetBorrowCF(i),
            liquidateCollateralFactor: getAssetLiquidateCF(i),
            liquidationFactor: getAssetLiquidationFactor(i),
            supplyCap: getAssetSupplyCap(i)
         });
    }

    function getAssetList(address account) external view returns (address[] memory result) {
        uint16 assetsIn = userBasic[account].assetsIn;

        uint8 count = 0;
        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                count++;
            }
        }

        result = new address[](count);

        uint j = 0;
        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                result[j] = getAssetAddress(i);
                j++;
            }
        }

        return result;
    }

    function accrue() external {
        accrueInternal();
    }
}