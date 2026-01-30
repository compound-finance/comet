// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../CometInterface.sol";

abstract contract CometHarnessInterfaceExtendedAssetList is CometInterface {
    function accrue() virtual external;
    function getNow() virtual external view returns (uint40);
    function setNow(uint now_) virtual external;
    function setTotalsBasic(TotalsBasic memory totals) virtual external;
    function setTotalsCollateral(address asset, TotalsCollateral memory totals) virtual external;
    function setBasePrincipal(address account, int104 principal) virtual external;
    function setCollateralBalance(address account, address asset, uint128 balance) virtual external;
    function updateAssetsInExternal(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance) virtual external;
    function getAssetList(address account) virtual external view returns (address[] memory);
    function assetList() virtual external view returns (address);
    function isLendersWithdrawPaused() virtual external view returns (bool);
    function isBorrowersWithdrawPaused() virtual external view returns (bool);
    function isCollateralAssetWithdrawPaused(uint24 assetIndex)  virtual external view returns (bool);
    function isCollateralSupplyPaused() virtual external view returns (bool);
    function isBaseSupplyPaused() virtual external view returns (bool);
    function isCollateralAssetSupplyPaused(uint24 assetIndex) virtual external view returns (bool);
    function isLendersTransferPaused() virtual external view returns (bool);
    function isBorrowersTransferPaused() virtual external view returns (bool);
    function isCollateralAssetTransferPaused(uint24 assetIndex) virtual external view returns (bool);
    function isCollateralTransferPaused() virtual external view returns (bool);
    function isCollateralWithdrawPaused() virtual external view returns (bool);
}
