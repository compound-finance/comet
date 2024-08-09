// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometExtendedAssetList.sol";
import "./CometConfiguration.sol";

contract CometFactoryExtendedAssetList is CometConfiguration {
    function clone(Configuration calldata config) external returns (address) {
        return address(new CometExtendedAssetList(config));
    }
}