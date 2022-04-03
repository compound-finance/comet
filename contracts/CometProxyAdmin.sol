// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./vendor/proxy/transparent/ProxyAdmin.sol";

interface Deployable {
  function deploy() external returns (address);
}

contract CometProxyAdmin is ProxyAdmin {
    /**
     * @dev Deploy a new Comet and upgrade the implementation of the Comet proxy
     *  Requirements:
     *   - This contract must be the admin of `CometProxy`
     */
    function deployAndUpgradeTo(Deployable configuratorProxy, TransparentUpgradeableProxy cometProxy) public virtual onlyOwner {
        address newCometImpl = configuratorProxy.deploy();
        upgrade(cometProxy, newCometImpl);
    }
}