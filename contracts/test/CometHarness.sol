// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../Comet.sol";

contract CometHarness is Comet {
    uint public nowOverride;

    constructor(Configuration memory config) Comet(config) {}

    function baseIndexScale() external view returns (uint64) {
        return BASE_INDEX_SCALE;
    }

    function maxAssets() external view returns (uint8) {
        return MAX_ASSETS;
    }

    function getNow() override public view returns (uint40) {
        return nowOverride > 0 ? uint40(nowOverride) : super.getNow();
    }

    function setNow(uint now_) external {
        nowOverride = now_;
    }

    function setTotalsBasic(TotalsBasic memory totals) external {
        totalsBasic = totals;
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
                result[j] = getAssetInfo(i).asset;
                j++;
            }
        }

        return result;
    }
}