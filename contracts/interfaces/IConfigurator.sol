// SPDX-License-Identifier: XXX ADD VALID LICENSE

pragma solidity ^0.8.11;

import "../CometConfiguration.sol";

interface IConfigurator is CometConfiguration {
    function setFactory(address _factory) external;

    function deployAndUpgrade(address proxy) external;

    function setConfiguration(Configuration memory config) external;

    function setGovernor(address governor) external;

    function addAsset(AssetConfig calldata asset) external;
}