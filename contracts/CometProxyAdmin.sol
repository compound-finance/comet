// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./vendor/proxy/transparent/ProxyAdmin.sol";

interface Deployable {
    function deploy(address cometProxy) external returns (address);
}

contract CometProxyAdmin is ProxyAdmin {
    /// @notice Pause flag for the market update admin
    bool public marketAdminPaused = false;

    /// @notice The address of the market update admin. This will be the address of a timelock contract.
    address public marketAdmin;

    /// @notice address of the market admin pause guardian. We don't use `pauseGuardian` because we have `setPauseGuardian` which sets the pauseGuardian on comet.
    address public marketAdminPauseGuardian;

    event SetMarketAdmin(address indexed oldAdmin, address indexed newAdmin);
    event MarketAdminPaused(address indexed caller, bool isMarketAdminPaused);
    event SetMarketAdminPauseGuardian(
        address indexed oldPauseGuardian,
        address indexed newPauseGuardian
    );
    error Unauthorized();
    error MarketAdminIsPaused();
    error AlreadyPaused();
    error AlreadyUnPaused();

    /**
     * @dev Throws if called by any account other than the owner and market update admin
     */
    modifier ownerOrMarketAdmin() {
        // using revert instead of require to keep it consistent with other calls
        if (owner() != _msgSender() && marketAdmin != _msgSender())
            revert Unauthorized();
        // If the sender is the marketAdmin, check that the marketAdmin is not paused
        if (_msgSender() == marketAdmin && marketAdminPaused)
            revert MarketAdminIsPaused();
        _;
    }

    /**
     * @notice Sets a new market admin for the contract.
     * @dev This function can only be called by the owner of the contract.
     * If the caller is not the owner, the function will revert with an Unauthorized error.
     * Note that there is no enforced zero address check on `newAdmin` as it may be a deliberate choice
     * to assign the zero address in certain scenarios. This design allows flexibility if the zero address
     * is intended to represent a specific state, such as temporarily disabling the market admin role.
     * @param newAdmin The address of the new market admin.
     */
    function setMarketAdmin(address newAdmin) public {
        address oldAdmin = marketAdmin;
        if (msg.sender != owner()) revert Unauthorized();
        marketAdmin = newAdmin;
        emit SetMarketAdmin(oldAdmin, newAdmin);
    }

    /**
     * @notice Pauses the market admin role.
     * @dev Can only be called by the owner or the market admin pause guardian.
     * Reverts with Unauthorized if the caller is neither.
     */
    function pauseMarketAdmin() external {
        if (marketAdminPaused) revert AlreadyPaused();
        if (msg.sender != owner() && msg.sender != marketAdminPauseGuardian)
            revert Unauthorized();
        marketAdminPaused = true;
        emit MarketAdminPaused(msg.sender, true);
    }

    /**
     * @notice Unpauses the market admin role.
     * @dev Can only be called by the owner.
     * Reverts with Unauthorized if the caller is not the owner.
     */
    function unpauseMarketAdmin() external {
        if (!marketAdminPaused) revert AlreadyUnPaused();
        if (msg.sender != owner()) revert Unauthorized();
        marketAdminPaused = false;
        emit MarketAdminPaused(msg.sender, false);
    }

    /**
     * @notice Sets a new market admin pause guardian.
     * @dev Can only be called by the owner. Reverts with Unauthorized if the caller is not the owner.
     * @param newPauseGuardian The address of the new market admin pause guardian.
     * Note that there is no enforced zero address check on `newPauseGuadian` as it may be a deliberate choice
     * to assign the zero address in certain scenarios. This design allows flexibility if the zero address
     * is intended to represent a specific state, such as temporarily disabling the pause guadian.
     */
    function setMarketAdminPauseGuardian(address newPauseGuardian) external {
        if (msg.sender != owner()) revert Unauthorized();
        address oldPauseGuardian = marketAdminPauseGuardian;
        marketAdminPauseGuardian = newPauseGuardian;
        emit SetMarketAdminPauseGuardian(oldPauseGuardian, newPauseGuardian);
    }

    /**
     * @dev Deploy a new Comet and upgrade the implementation of the Comet proxy
     *  Requirements:
     *   - This contract must be the admin or market admin of `CometProxy`
     */
    function deployAndUpgradeTo(Deployable configuratorProxy, TransparentUpgradeableProxy cometProxy) public virtual ownerOrMarketAdmin {
        address newCometImpl = configuratorProxy.deploy(address(cometProxy));
        _upgrade(cometProxy, newCometImpl);
    }

    /**
     * @dev Deploy a new Comet and upgrade the implementation of the Comet proxy, then call the function
     *  Requirements:
     *   - This contract must be the admin or market admin of `CometProxy`
     */
    function deployUpgradeToAndCall(Deployable configuratorProxy, TransparentUpgradeableProxy cometProxy, bytes memory data) public virtual ownerOrMarketAdmin {
        address newCometImpl = configuratorProxy.deploy(address(cometProxy));
        _upgradeAndCall(cometProxy, newCometImpl, data);
    }

    /**
  * @dev Custom upgrade function that allows owner and marketUpdateAdmin to call it
     */
    function _upgrade(TransparentUpgradeableProxy proxy, address implementation) private ownerOrMarketAdmin {
        proxy.upgradeTo(implementation);
    }

    /**
     * @dev Custom upgradeAndCall function that allows owner and marketUpdateAdmin to call it
     */
    function _upgradeAndCall(TransparentUpgradeableProxy proxy, address implementation, bytes memory data) private ownerOrMarketAdmin {
        proxy.upgradeToAndCall(implementation, data);
    }
}
