// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometModifiedWithExtendedAssetList.sol";
import "../CometConfiguration.sol";

contract CometModifiedFactoryWithExtendedAssetList is CometConfiguration {
    function clone(Configuration calldata config) external returns (address) {
        return address(new CometModifiedWithExtendedAssetList(config));
    }
}