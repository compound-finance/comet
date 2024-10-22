// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface ICreate2Deployer {
    /**
     * @dev Deploys a contract using `CREATE2`.
     * @param value Amount of ETH to send with the contract creation.
     * @param salt A unique salt used to compute the deployment address.
     * @param code The bytecode of the contract to deploy.
     */
    function deploy(uint256 value, bytes32 salt, bytes memory code) external;

    /**
     * @dev Returns the address where a contract will be stored if deployed via `deploy`.
     * @param salt A unique salt used to compute the deployment address.
     * @param codeHash The keccak256 hash of the contract bytecode.
     */
    function computeAddress(bytes32 salt, bytes32 codeHash) external view returns (address);
}
