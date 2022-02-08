// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./vendor/proxy/TransparentUpgradeableProxy.sol";

// XXX should have its own storage for pending params
contract TransparentUpgradeableFactoryProxy is TransparentUpgradeableProxy, CometConfiguration {
    address public factory;

    /**
     * @dev Initializes an upgradeable proxy managed by `_admin`, backed by the implementation at `_logic`, and
     * optionally initialized with `_data` as explained in {UpgradeableProxy-constructor}.
     */
    constructor(address factory_, address _logic, address _admin, bytes memory _data) payable TransparentUpgradeableProxy(_logic, _admin, _data) {
        factory = factory_;
    }

    // XXX Test that this is only callable by an admin
    /**
     * @dev Upgrade the implementation of the proxy by specifying some configuration.
     *
     * NOTE: Only the admin can call this function. See {ProxyAdmin-upgrade}.
     */
    function upgrade(Configuration memory config) external ifAdmin {

        // XXX can read all these fields from existing storage?
        address newComet = CometFactory(factory).clone(config);
        _upgradeTo(newComet);
    }

    // XXX Define other setters to set params
    function setPriceOracle(address asset, address priceFeed) public {
    }
}