// SPDX-License-Identifier: XXX ADD VALID LICENSE

pragma solidity ^0.8.11;

interface ITransparentUpgradeableProxy {
    function admin() external returns (address);

    function implementation() external returns (address);

    function changeAdmin(address newAdmin) external;

    function upgradeTo(address newImplementation) external;

    function upgradeToAndCall(address newImplementation, bytes calldata data)
        external
        payable;
}
