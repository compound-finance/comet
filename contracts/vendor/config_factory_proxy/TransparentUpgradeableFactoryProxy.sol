// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./UpgradeableFactoryProxy.sol";
import "../../ConfigFactory.sol";

/**
 * @dev This contract implements a proxy that is upgradeable by an admin.
 * @dev Modified from the original OZ Proxy to save 1 SLOAD per delegated call. Admin variable is immutable, no admin upgrades are allowed.
 *
 * To avoid https://medium.com/nomic-labs-blog/malicious-backdoors-in-ethereum-proxies-62629adf3357[proxy selector
 * clashing], which can potentially be used in an attack, this contract uses the
 * https://blog.openzeppelin.com/the-transparent-proxy-pattern/[transparent proxy pattern]. This pattern implies two
 * things that go hand in hand:
 *
 * 1. If any account other than the admin calls the proxy, the call will be forwarded to the implementation, even if
 * that call matches one of the admin functions exposed by the proxy itself.
 * 2. If the admin calls the proxy, it can access the admin functions, but its calls will never be forwarded to the
 * implementation. If the admin tries to call a function on the implementation it will fail with an error that says
 * "admin cannot fallback to proxy target".
 *
 * These properties mean that the admin account can only be used for admin actions like upgrading the proxy or changing
 * the admin, so it's best if it's a dedicated account that is not used for anything else. This will avoid headaches due
 * to sudden errors when trying to call a function from the proxy implementation.
 *
 * Our recommendation is for the dedicated account to be an instance of the {ProxyAdmin} contract. If set up this way,
 * you should think of the `ProxyAdmin` instance as the real administrative interface of your proxy.
 */
contract TransparentUpgradeableFactoryProxy is UpgradeableFactoryProxy {
    /**
     * @dev Initializes an upgradeable proxy managed by `_admin`, backed by the config factory at `_configFactory`
     */
    constructor(address admin_, ConfigFactory _configFactory, uint targetReserves, uint borrowMin) payable UpgradeableFactoryProxy() {
        configFactory = _configFactory;
        address config = configFactory.createConfig(targetReserves, borrowMin);
        _setImplementation(config);

        admin = admin_;
    }

    /**
     * @dev The immutable admin of the contract.
     * This is a modificaton comparing to standard recommended OpenZeppelin Transparent Upgradable Proxy.
     * It allows us to save 1 SLOAD per delegation call without using newest UUP pattern.
     */
    address public immutable admin;
    ConfigFactory public configFactory;

    /**
     * @dev Modifier used internally that will delegate the call to the implementation unless the sender is the admin.
     */
    modifier ifAdmin() {
        if (msg.sender == admin) {
            _;
        } else {
            _fallback();
        }
    }

    /**
     * @dev Returns the current implementation.
     *
     * NOTE: Only the admin can call this function. See {ProxyAdmin-getProxyImplementation}.
     *
     * TIP: To get this value clients can read directly from the storage slot shown below (specified by EIP1967) using the
     * https://eth.wiki/json-rpc/API#eth_getstorageat[`eth_getStorageAt`] RPC call.
     * `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`
     */
    function implementation() external ifAdmin returns (address implementation_) {
        implementation_ = _implementation();
    }

    /**
     * @dev Upgrade the config implementation of the proxy using config factory.
     *
     * NOTE: Only the admin can call this function. See {ProxyAdmin-upgrade}.
     */
    function upgradeToParams(uint targetReserves, uint borrowMin) external virtual ifAdmin {
        address newImplementation = configFactory.createConfig(targetReserves, borrowMin);
        _upgradeTo(newImplementation);
    }

    /**
     * @dev Makes sure the admin cannot access the fallback function. See {Proxy-_beforeFallback}.
     */
    function _beforeFallback() internal virtual override {
        require(msg.sender != admin, "TransparentUpgradeableProxy: admin cannot fallback to proxy target");
        super._beforeFallback();
    }
}
