// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../Comet.sol";

contract CometHarness is Comet {
    struct AssetInfo {
        uint8 offset;
        address asset;
        address priceFeed;
        uint64 scale;
        uint64 borrowCollateralFactor;
        uint64 liquidateCollateralFactor;
        uint64 liquidationFactor;
        uint128 supplyCap;
    }

    uint public nowOverride;

    constructor(Configuration memory config) Comet(config) {}

    function getNow() override public view returns (uint40) {
        return nowOverride > 0 ? uint40(nowOverride) : super.getNow();
    }

    function setNow(uint now_) public {
        nowOverride = now_;
    }

    function setTotalsBasic(TotalsBasic memory totals) public {
        totalsBasic = totals;
    }

    function setTotalsCollateral(address asset, TotalsCollateral memory totals) public {
        totalsCollateral[asset] = totals;
    }

    function setBasePrincipal(address account, int104 principal) public {
        userBasic[account].principal = principal;
    }

    function setCollateralBalance(address account, address asset, uint128 balance) public {
        uint128 oldBalance = userCollateral[account][asset].balance;
        userCollateral[account][asset].balance = balance;
        updateAssetsIn(account, asset, oldBalance, balance);
    }

    function updateAssetsInExternal(
        address account,
        address asset,
        uint128 initialUserBalance,
        uint128 finalUserBalance
    ) public {
        updateAssetsIn(account, asset, initialUserBalance, finalUserBalance);
    }

    function getAssetList(address account) public view returns (address[] memory result) {
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

    /**
     * @notice Get the i-th asset info, according to the order they were passed in originally
     * @param i The index of the asset info to get
     * @return The asset info object
     */
    function getAssetInfo(uint8 i) public view returns (AssetInfo memory) {
        require(i < numAssets, "asset info not found");

        if (i == 0) {
            return AssetInfo({
                offset: i,
                asset: assetAddress00,
                priceFeed: priceFeed00,
                scale: scale00,
                borrowCollateralFactor: borrowCollateralFactor00,
                liquidateCollateralFactor: liquidateCollateralFactor00,
                liquidationFactor: liquidationFactor00,
                supplyCap: supplyCap00
            });
        } else if (i == 1) {
            return AssetInfo({
                offset: i,
                asset: assetAddress01,
                priceFeed: priceFeed01,
                scale: scale01,
                borrowCollateralFactor: borrowCollateralFactor01,
                liquidateCollateralFactor: liquidateCollateralFactor01,
                liquidationFactor: liquidationFactor01,
                supplyCap: supplyCap01
            });
        } else if (i == 2) {
            return AssetInfo({
                offset: i,
                asset: assetAddress02,
                priceFeed: priceFeed02,
                scale: scale02,
                borrowCollateralFactor: borrowCollateralFactor02,
                liquidateCollateralFactor: liquidateCollateralFactor02,
                liquidationFactor: liquidationFactor02,
                supplyCap: supplyCap02
            });
        } else if (i == 3) {
            return AssetInfo({
                offset: i,
                asset: assetAddress03,
                priceFeed: priceFeed03,
                scale: scale03,
                borrowCollateralFactor: borrowCollateralFactor03,
                liquidateCollateralFactor: liquidateCollateralFactor03,
                liquidationFactor: liquidationFactor03,
                supplyCap: supplyCap03
            });
        } else if (i == 4) {
            return AssetInfo({
                offset: i,
                asset: assetAddress04,
                priceFeed: priceFeed04,
                scale: scale04,
                borrowCollateralFactor: borrowCollateralFactor04,
                liquidateCollateralFactor: liquidateCollateralFactor04,
                liquidationFactor: liquidationFactor04,
                supplyCap: supplyCap04
            });
        } else if (i == 5) {
            return AssetInfo({
                offset: i,
                asset: assetAddress05,
                priceFeed: priceFeed05,
                scale: scale05,
                borrowCollateralFactor: borrowCollateralFactor05,
                liquidateCollateralFactor: liquidateCollateralFactor05,
                liquidationFactor: liquidationFactor05,
                supplyCap: supplyCap05
            });
        } else if (i == 6) {
            return AssetInfo({
                offset: i,
                asset: assetAddress06,
                priceFeed: priceFeed06,
                scale: scale06,
                borrowCollateralFactor: borrowCollateralFactor06,
                liquidateCollateralFactor: liquidateCollateralFactor06,
                liquidationFactor: liquidationFactor06,
                supplyCap: supplyCap06
            });
        } else if (i == 7) {
            return AssetInfo({
                offset: i,
                asset: assetAddress07,
                priceFeed: priceFeed07,
                scale: scale07,
                borrowCollateralFactor: borrowCollateralFactor07,
                liquidateCollateralFactor: liquidateCollateralFactor07,
                liquidationFactor: liquidationFactor07,
                supplyCap: supplyCap07
            });
        } else if (i == 8) {
            return AssetInfo({
                offset: i,
                asset: assetAddress08,
                priceFeed: priceFeed08,
                scale: scale08,
                borrowCollateralFactor: borrowCollateralFactor08,
                liquidateCollateralFactor: liquidateCollateralFactor08,
                liquidationFactor: liquidationFactor08,
                supplyCap: supplyCap08
            });
        } else if (i == 9) {
            return AssetInfo({
                offset: i,
                asset: assetAddress09,
                priceFeed: priceFeed09,
                scale: scale09,
                borrowCollateralFactor: borrowCollateralFactor09,
                liquidateCollateralFactor: liquidateCollateralFactor09,
                liquidationFactor: liquidationFactor09,
                supplyCap: supplyCap09
            });
        } else if (i == 10) {
            return AssetInfo({
                offset: i,
                asset: assetAddress10,
                priceFeed: priceFeed10,
                scale: scale10,
                borrowCollateralFactor: borrowCollateralFactor10,
                liquidateCollateralFactor: liquidateCollateralFactor10,
                liquidationFactor: liquidationFactor10,
                supplyCap: supplyCap10
            });
        } else if (i == 11) {
            return AssetInfo({
                offset: i,
                asset: assetAddress11,
                priceFeed: priceFeed11,
                scale: scale11,
                borrowCollateralFactor: borrowCollateralFactor11,
                liquidateCollateralFactor: liquidateCollateralFactor11,
                liquidationFactor: liquidationFactor11,
                supplyCap: supplyCap11
            });
        } else if (i == 12) {
            return AssetInfo({
                offset: i,
                asset: assetAddress12,
                priceFeed: priceFeed12,
                scale: scale12,
                borrowCollateralFactor: borrowCollateralFactor12,
                liquidateCollateralFactor: liquidateCollateralFactor12,
                liquidationFactor: liquidationFactor12,
                supplyCap: supplyCap12
            });
        } else if (i == 13) {
            return AssetInfo({
                offset: i,
                asset: assetAddress13,
                priceFeed: priceFeed13,
                scale: scale13,
                borrowCollateralFactor: borrowCollateralFactor13,
                liquidateCollateralFactor: liquidateCollateralFactor13,
                liquidationFactor: liquidationFactor13,
                supplyCap: supplyCap13
            });
        } else if (i == 14) {
            return AssetInfo({
                offset: i,
                asset: assetAddress14,
                priceFeed: priceFeed14,
                scale: scale14,
                borrowCollateralFactor: borrowCollateralFactor14,
                liquidateCollateralFactor: liquidateCollateralFactor14,
                liquidationFactor: liquidationFactor14,
                supplyCap: supplyCap14
            });
        } else {
            revert("absurd");
        }
    }


}