// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @title Compound's Health Factor Holder Interface
 * @author Compound
 */
interface IHealthFactorHolder {
    /**
     * @notice Get the target health factor
     * @return targetHealthFactor The target health factor
     */
    function targetHealthFactor(address comet) external view returns (uint256);
}