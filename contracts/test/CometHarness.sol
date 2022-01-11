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
     * @dev external function wrapping _updateAssetsIn for testing
     */
    function updateAssetsIn(
        address account,
        address asset,
        uint initialUserBalance,
        uint finalUserBalance
    ) public {
        _updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    }

    /**
     * @dev helper function for testing _updateAssetsIn
     */
    function isInAsset(address account, address asset) public view returns (bool) {
        uint16 assetsIn = users[account].assetsIn;
        uint8 assetOffset = _getAssetOffset(asset);
        return (assetsIn & (uint8(1) << assetOffset) != 0);
    }
}