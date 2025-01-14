// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @title Compound's Asset List Factory Holder Interface
 * @author Compound
 */
interface IAssetListFactoryHolder {
    /**
     * @notice Get the asset list factory
     * @return assetListFactory The asset list factory address
     */
    function assetListFactory() external view returns (address);
}