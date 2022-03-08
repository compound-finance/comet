// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../vendor/proxy/ProxyAdmin.sol";

contract CometProxyAdmin is ProxyAdmin {
    /**
     * @dev Deploy a new Comet and upgrade the implementation of the Comet proxy.
     *
     * Requirements:
     *
     * - This contract must be the admin of `CometProxy`.
     */
    function deployAndUpgradeTo(TransparentUpgradeableProxy configuratorProxy, TransparentUpgradeableProxy cometProxy) public virtual onlyOwner {
        (bool success, bytes memory returnData) = address(configuratorProxy).call(abi.encodeWithSignature("deploy()"));
        require(success, "failed to deploy new contract");

        (address newCometImpl) = abi.decode(returnData, (address)); 
        upgrade(cometProxy, newCometImpl);
    }
} 