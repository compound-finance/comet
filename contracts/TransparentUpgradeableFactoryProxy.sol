// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometFactory.sol";
import "./CometStorage.sol";
import "./CometConfiguration.sol";
import "./vendor/proxy/TransparentUpgradeableProxy.sol";

contract TransparentUpgradeableFactoryProxy is TransparentUpgradeableProxy, CometConfigurationStorage {
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
    function upgrade() external ifAdmin {
        // XXX Can we read configuration directly from Comet contract?
        // Will be difficult for governance because governance would have to
        // specify all params, even if they are not being changed
        address newComet = CometFactory(factory).clone(configuratorParams);
        _upgradeTo(newComet);
    }

    // XXX Define other setters for setting params
    function setGovernor(address governor) external {
        configuratorParams.governor = governor;
    }
}