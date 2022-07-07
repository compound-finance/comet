// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./vendor/proxy/transparent/TransparentUpgradeableProxy.sol";

/**
 * @dev A TransparentUpgradeableProxy that allows its admin to call its implementation.
 */
contract ConfiguratorProxy is TransparentUpgradeableProxy {
    /**
     * @dev Initializes an upgradeable proxy managed by `_admin`, backed by the implementation at `_logic`, and
     * optionally initialized with `_data` as explained in {UpgradeableProxy-constructor}.
     */
    constructor(address _logic, address _admin, bytes memory _data) payable TransparentUpgradeableProxy(_logic, _admin, _data) {}

    /**
     * @dev Overrides the TransparentUpgradeableProxy's _beforeFallback so admin can call the implementation.
     */
    function _beforeFallback() internal virtual override {}
}
