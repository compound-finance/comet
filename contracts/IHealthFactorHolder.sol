// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @title Compound's Health Factor Holder Interface
 * @author Compound
 */
interface IHealthFactorHolder {
    /**
     * @notice Get the health factor
     * @return healthFactor The health factor
     */
    function healthFactor(address comet) external view returns (uint256);

    /**
     * @notice Get the health factor for a specific Comet address (from a configurator)
     * @param comet The address of the Comet
     * @return healthFactors The health factors for the given Comet address
     */
    function healthFactors(address comet) external view returns (uint256);
}