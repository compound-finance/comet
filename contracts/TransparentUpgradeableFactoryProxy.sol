// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometFactory.sol";
import "./CometStorage.sol";
import "./CometConfiguration.sol";
import "./vendor/proxy/TransparentUpgradeableProxy.sol";

contract TransparentUpgradeableFactoryProxy is TransparentUpgradeableProxy, CometStorage {
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
     * @dev Deploy and upgrade the implementation of the proxy.
     *
     * NOTE: Only the admin can call this function. See {ProxyAdmin-deployAndUpgrade}.
     */
    function deployAndUpgrade() external ifAdmin {
        // XXX Can we read configuration directly from Comet contract?
        // Will be difficult for governance because governance would have to
        // specify all params, even if they are not being changed
        address newComet = CometFactory(factory).clone(configuratorParams);
        _upgradeTo(newComet);
    }

    // XXX see if there is a cleaner way to do this
    function setConfiguration(Configuration memory config) external ifAdmin {
        Configuration storage _configuratorParams = configuratorParams;
        _configuratorParams.governor = config.governor;
        _configuratorParams.pauseGuardian = config.pauseGuardian;
        _configuratorParams.baseToken = config.baseToken;
        _configuratorParams.baseTokenPriceFeed = config.baseTokenPriceFeed;
        _configuratorParams.kink = config.kink;
        _configuratorParams.perYearInterestRateSlopeLow = config.perYearInterestRateSlopeLow;
        _configuratorParams.perYearInterestRateSlopeHigh = config.perYearInterestRateSlopeHigh;
        _configuratorParams.perYearInterestRateBase = config.perYearInterestRateBase;
        _configuratorParams.reserveRate = config.reserveRate;
        _configuratorParams.trackingIndexScale = config.trackingIndexScale;
        _configuratorParams.baseTrackingSupplySpeed = config.baseTrackingSupplySpeed;
        _configuratorParams.baseTrackingBorrowSpeed = config.baseTrackingBorrowSpeed;
        _configuratorParams.baseMinForRewards = config.baseMinForRewards;
        _configuratorParams.baseBorrowMin = config.baseBorrowMin;
        _configuratorParams.targetReserves = config.targetReserves;
        _configuratorParams.governor = config.governor;
        _configuratorParams.governor = config.governor;

        // Need to copy using this loop because directly copying of an array of structs is not supported
        for (uint256 i = 0; i < config.assetConfigs.length; i++) {
            if (i < _configuratorParams.assetConfigs.length) {
                _configuratorParams.assetConfigs[i] = config.assetConfigs[i];
            } else {
                _configuratorParams.assetConfigs.push(config.assetConfigs[i]);
            }
        }
    }

    // XXX Define other setters for setting params
    function setGovernor(address governor) external ifAdmin {
        configuratorParams.governor = governor;
    }

    // XXX What about removing an asset?
    function addAsset(AssetConfig calldata asset) external ifAdmin {
        configuratorParams.assetConfigs.push(asset);
    }
}