// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometExt.sol";

contract CometExtAssetList is CometExt {

    address immutable public assetListFactory;

    /**
     * @notice Construct a new protocol instance
     * @param config The mapping of initial/constant parameters
     * @param assetListFactoryAddress The address of the asset list factory
     **/
    constructor(ExtConfiguration memory config, address assetListFactoryAddress) CometExt(config) {
        assetListFactory = assetListFactoryAddress;
    }
}