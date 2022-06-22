// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../CometInterface.sol";

abstract contract CometHarnessInterface is CometInterface {
    function accrue() virtual external;
    function getNow() virtual external view returns (uint40);
    function setNow(uint now_) virtual external;
    function setTotalsBasic(TotalsBasic memory totals) virtual external;
    function setTotalsCollateral(address asset, TotalsCollateral memory totals) virtual external;
    function setBasePrincipal(address account, int104 principal) virtual external;
    function setCollateralBalance(address account, address asset, uint128 balance) virtual external;
    function updateAssetsInExternal(address account, address asset, uint128 initialUserBalance, uint128 finalUserBalance) virtual external;
    function getAssetList(address account) virtual external view returns (address[] memory);
}
