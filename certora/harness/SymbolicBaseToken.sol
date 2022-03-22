// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "./DummyERC20Impl.sol";

/**
 * @title Certora's Symbolic Base Token contract for comet
 * @notice Represent an ERC20 base token.
 * @author Certora
 */
contract SymbolicBaseToken is DummyERC20Impl {
    // This contract represents a concrete ERC20 token with a unique address.
    // Such dummy implementaions of tokens are often used when comparing
    // two distinct tokens with distinct address that should retrieve values independently from one another
}