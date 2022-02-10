// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometConfiguration.sol";
import "./CometStorage.sol";
import "./TransparentUpgradeableFactoryProxy.sol";
import "./vendor/proxy/ProxyAdmin.sol";

contract CometProxyAdmin is ProxyAdmin, CometConfiguration {
    /**
     * @dev Deploy and upgrade the implementation of the proxy.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function deployAndUpgrade(TransparentUpgradeableFactoryProxy proxy) public virtual onlyOwner {
        proxy.deployAndUpgrade();
    }

    /**
     * @dev Set the entire configuration param in the configurator.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function setConfiguration(TransparentUpgradeableFactoryProxy proxy, Configuration memory config) public virtual onlyOwner {
        proxy.setConfiguration(config);
    }
    
    /**
     * @dev Set the governor param in the configurator.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function setGovernor(TransparentUpgradeableFactoryProxy proxy, address governor) public virtual onlyOwner {
        proxy.setGovernor(governor);
    }

    /**
     * @dev Adds an asset config param to the configurator.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function addAsset(TransparentUpgradeableFactoryProxy proxy, AssetConfig calldata asset) public virtual onlyOwner {
        proxy.addAsset(asset);
    }
}