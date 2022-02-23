// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./vendor/proxy/TransparentUpgradeableProxy.sol";

contract TransparentUpgradeableFactoryProxy is TransparentUpgradeableProxy {

    /**
     * @dev Initializes an upgradeable proxy managed by `_admin`, backed by the implementation at `_logic`, and
     * optionally initialized with `_data` as explained in {UpgradeableProxy-constructor}.
     */
    constructor(address configurator_, address _logic, address _admin, bytes memory _data) payable TransparentUpgradeableProxy(_logic, _admin, _data) {
        assert(_CONFIGURATOR_SLOT == bytes32(uint256(keccak256("comet.proxy.configurator")) - 1));
        _setConfigurator(configurator_);
    }

    /**
     * @dev Emitted when the admin account has changed.
     */
    event ConfiguratorChanged(address previousConfigurator, address newConfigurator);

    /**
     * @dev Storage slot with the configurator of the contract.
     * This is the keccak-256 hash of "eip1967.proxy.configurator" subtracted by 1, and is
     * validated in the constructor.
     */
    bytes32 private constant _CONFIGURATOR_SLOT = 0xe95db45f46f3791feb4f7d996d8581f99d5e5632646ab8f06e76ea4548157f61;

    // XXX Get rid of virtual?
    /**
     * @dev Changes the configurator of the proxy.
     *
     * Emits an {ConfiguratorChanged} event.
     *
     * NOTE: Only the admin can call this function. See {ProxyAdmin-changeProxyAdmin}.
     */
    function changeConfigurator(address newConfigurator) external virtual ifAdmin {
        require(newConfigurator != address(0), "cannot be zero address");
        emit ConfiguratorChanged(_configurator(), newConfigurator);
        _setConfigurator(newConfigurator);
    }

    /**
     * @dev Returns the current configurator.
     */
    function _configurator() internal view virtual returns (address c) {
        bytes32 slot = _CONFIGURATOR_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            c := sload(slot)
        }
    }

    /**
     * @dev Stores a new address in the configurator slot.
     */
    function _setConfigurator(address newConfigurator) private {
        bytes32 slot = _CONFIGURATOR_SLOT;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, newConfigurator)
        }
    }

    /**
     * @dev Delegates the current call to the address returned by `_implementation()`.
     *
     * This function does not return to its internall call site, it will return directly to the external caller.
     */
    function _fallback() internal virtual override {
        // _beforeFallback(); // Not calling _beforeFallback() since it is only used to filter out calls by admin

        if (msg.sender == _admin()) {
            _delegate(_configurator());
        } else {
            _delegate(_implementation());
        }
    }
}