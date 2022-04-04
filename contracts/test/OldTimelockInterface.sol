// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

// Needed for calling the outdated Timelock contract on testnets. Used in migration scripts.
abstract contract OldTimelockInterface {
    function execute(address[] calldata targets, uint[] calldata values, string[] calldata signatures, bytes[] calldata data) virtual public;
}
