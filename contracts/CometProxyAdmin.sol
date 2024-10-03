// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./vendor/proxy/transparent/ProxyAdmin.sol";
import "./marketupdates/MarketAdminPermissionCheckerInterface.sol";

interface Deployable {
  function deploy(address cometProxy) external returns (address);
}

contract CometProxyAdmin is ProxyAdmin {

    /// @notice MarketAdminPermissionChecker contract which is used to check if the caller has permission to perform market updates(or deployment)
    MarketAdminPermissionCheckerInterface public marketAdminPermissionChecker;

    event SetMarketAdminPermissionChecker(address indexed oldMarketAdminPermissionChecker, address indexed newMarketAdminPermissionChecker);
    error Unauthorized();

    /**
     * @dev Ensures that the caller is either the owner or the market admin.
     * This delegates the permission check logic to the MarketAdminPermissionChecker contract.
     */
    modifier ownerOrMarketAdmin {
        if(_msgSender() != owner()) marketAdminPermissionChecker.checkUpdatePermission(_msgSender());
        _;
    }

    /**
     * @dev Initializes the contract setting the specified address as the initial owner.
     * @param initialOwner The address to set as the owner of the contract.
     */
    constructor(address initialOwner) ProxyAdmin(initialOwner) {}

    /**
     * @dev Deploy a new Comet and upgrade the implementation of the Comet proxy
     *  Requirements:
     *   - This contract must be the admin of `CometProxy`
     */
    function deployAndUpgradeTo(Deployable configuratorProxy, TransparentUpgradeableProxy cometProxy) public virtual ownerOrMarketAdmin {
        address newCometImpl = configuratorProxy.deploy(address(cometProxy));
        _upgrade(cometProxy, newCometImpl);
    }

    /**
     * @dev Deploy a new Comet and upgrade the implementation of the Comet proxy, then call the function
     *  Requirements:
     *   - This contract must be the admin of `CometProxy`
     */
    function deployUpgradeToAndCall(Deployable configuratorProxy, TransparentUpgradeableProxy cometProxy, bytes memory data) public virtual ownerOrMarketAdmin {
        address newCometImpl = configuratorProxy.deploy(address(cometProxy));
        _upgradeAndCall(cometProxy, newCometImpl, data);
    }

    /**
    * @notice Sets the MarketAdminPermissionChecker contract
    * @dev Note: Only callable by main-governor-timelock
    **/
    function setMarketAdminPermissionChecker(MarketAdminPermissionCheckerInterface newMarketAdminPermissionChecker) external {
        if (_msgSender() != owner()) revert Unauthorized();
        address oldMarketAdminPermissionChecker = address(marketAdminPermissionChecker);
        marketAdminPermissionChecker = newMarketAdminPermissionChecker;
        emit SetMarketAdminPermissionChecker(oldMarketAdminPermissionChecker, address(newMarketAdminPermissionChecker));
    }


    /**
     * @dev Custom upgrade function that allows owner and marketAdmin to call it
     */
    function _upgrade(TransparentUpgradeableProxy proxy, address implementation) private ownerOrMarketAdmin {
        proxy.upgradeTo(implementation);
    }

    /**
     * @dev Custom upgradeAndCall function that allows owner and marketAdmin to call it
     */
    function _upgradeAndCall(TransparentUpgradeableProxy proxy, address implementation, bytes memory data) private ownerOrMarketAdmin {
        proxy.upgradeToAndCall(implementation, data);
    }
}
