// SPDX-License-Identifier: XXX ADD VALID LICENSE

pragma solidity ^0.8.11;

import "./vendor/access/Ownable.sol";
import "./vendor/proxy/ProxyAdmin.sol";

/**
 * @dev This is an auxiliary contract meant to be assigned as the admin of a {ProxyAdmin}.
 */
contract ProxyAdminAdmin is Ownable {

    /**
     * @dev Deploy and upgrade the implementation of the Comet proxy.
     *
     * Requirements:
     *
     * - This contract must be the admin of `ProxyAdmin`.
     */
    function deployAndUpgradeTo(ProxyAdmin proxyAdmin, TransparentUpgradeableProxy configuratorProxy, TransparentUpgradeableProxy cometProxy) public virtual onlyOwner {
        (bool success, bytes memory returnData) = address(configuratorProxy).call(abi.encodeWithSignature("deploy()"));
        require(success, "failed to deploy new contract");

        (address newCometImpl) = abi.decode(returnData, (address)); 
        proxyAdmin.upgrade(cometProxy, newCometImpl);
    }

    // XXX do we need this to be `payable`?
    function execute(address target, uint value, string memory signature, bytes memory data) public payable onlyOwner returns (bytes memory) {
        bytes memory callData;

        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        // solium-disable-next-line security/no-call-value
        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        require(success, "failed to call");

        return returnData;
    }
}
