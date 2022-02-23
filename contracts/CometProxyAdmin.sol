// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometConfiguration.sol";
import "./CometStorage.sol";
import "./vendor/proxy/ProxyAdmin.sol";
import "./interfaces/IConfigurator.sol";
import "./interfaces/ITransparentUpgradeableProxy.sol";

contract CometProxyAdmin is ProxyAdmin, CometConfiguration {

    /**
     * @dev Sets the factory contract in the configurator.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function setFactory(address proxy, address factory) public virtual onlyOwner {
        IConfigurator(proxy).setFactory(factory);
    }

    /**
     * @dev Deploy and upgrade the implementation of the proxy.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function deployAndUpgradeTo(address proxy) public virtual onlyOwner {
        address newComet = IConfigurator(proxy).deploy();
        ITransparentUpgradeableProxy(proxy).upgradeTo(newComet);
    }

    /**
     * @dev Set the entire configuration param in the configurator.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function setConfiguration(address proxy, Configuration memory config) public virtual onlyOwner {
        IConfigurator(proxy).setConfiguration(config);
    }
    
    /**
     * @dev Set the governor param in the configurator.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function setGovernor(address proxy, address governor) public virtual onlyOwner {
        IConfigurator(proxy).setGovernor(governor);
    }

    /**
     * @dev Adds an asset config param to the configurator.
     *
     * Requirements:
     *
     * - This contract must be the admin of `proxy`.
     */
    function addAsset(address proxy, AssetConfig calldata asset) public virtual onlyOwner {
        IConfigurator(proxy).addAsset(asset);
    }
}