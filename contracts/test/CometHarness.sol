// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "../Comet.sol";

contract CometHarness is Comet {
    uint public nowOverride;

    constructor(Configuration memory config) Comet(config) {}

    function getNow() override public view returns (uint40) {
        return nowOverride > 0 ? uint40(nowOverride) : super.getNow();
    }

    function setNow(uint now_) public {
        nowOverride = now_;
    }

    function setTotals(Totals memory totals_) public {
        totals = totals_;
    }

    /**
     * @dev function wrapping updateAssetsIn for testing
     */
    function updateAssetsInExternal(
        address account,
        address asset,
        uint128 initialUserBalance,
        uint128 finalUserBalance
    ) public {
        updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    }

    /**
     * @dev return list of assets that account has non-zero balance in
     */
    function getAssetList(address account) public view returns (address[] memory result) {
        uint16 assetsIn = users[account].assetsIn;

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