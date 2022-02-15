// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

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

    function accrue() external {
        totalsBasic = accrueInternal(totalsBasic);
    }

    function getSupplyRate() external view returns (uint64) {
        TotalsBasic memory totals = totalsBasic;
        return getSupplyRateInternal(totals.baseSupplyIndex, totals.baseBorrowIndex, totals.totalSupplyBase, totals.totalBorrowBase);
    }

    function getBorrowRate() external view returns (uint64) {
        TotalsBasic memory totals = totalsBasic;
        return getBorrowRateInternal(totals.baseSupplyIndex, totals.baseBorrowIndex, totals.totalSupplyBase, totals.totalBorrowBase);
    }

    function getUtilization() external view returns (uint) {
        TotalsBasic memory totals = totalsBasic;
        return getUtilizationInternal(totals.baseSupplyIndex, totals.baseBorrowIndex, totals.totalSupplyBase, totals.totalBorrowBase);
    }

    /**
     * @notice Calculate the amount of borrow liquidity for account
     * @param account The address to check liquidity for
     * @return The common price quantity of borrow liquidity
     */
    function getBorrowLiquidity(address account) external view returns (int) {
        uint16 assetsIn = userBasic[account].assetsIn;
        TotalsBasic memory totals = totalsBasic;

        int liquidity = signedMulPrice(
            presentValue(totals, userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            baseScale
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                AssetInfo memory asset = getAssetInfo(i);
                uint newAmount = mulPrice(
                    userCollateral[account][asset.asset].balance,
                    getPrice(asset.priceFeed),
                    safe64(asset.scale)
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    asset.borrowCollateralFactor
                ));
            }
        }

        return liquidity;
    }

    /**
     * @notice Calculate the amount of liquidation margin for account
     * @param account The address to check margin for
     * @return The common price quantity of liquidation margin
     */
    function getLiquidationMargin(address account) external view returns (int) {
        uint16 assetsIn = userBasic[account].assetsIn;
        TotalsBasic memory totals = totalsBasic;

        int liquidity = signedMulPrice(
            presentValue(totals, userBasic[account].principal),
            getPrice(baseTokenPriceFeed),
            baseScale
        );

        for (uint8 i = 0; i < numAssets; i++) {
            if (isInAsset(assetsIn, i)) {
                AssetInfo memory asset = getAssetInfo(i);
                uint newAmount = mulPrice(
                    userCollateral[account][asset.asset].balance,
                    getPrice(asset.priceFeed),
                    asset.scale
                );
                liquidity += signed256(mulFactor(
                    newAmount,
                    asset.liquidateCollateralFactor
                ));
            }
        }

        return liquidity;
    }
}