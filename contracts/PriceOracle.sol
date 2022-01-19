// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

abstract contract PriceOracle {
    /// @notice Indicator that this is a PriceOracle contract (for inspection)
    bool public constant isPriceOracle = true;

    /**
      * @notice Get the price of an asset
      * @param asset Address of token to get price of
      * @return The underlying asset price mantissa (scaled by 1e18).
      *  Zero means the price is unavailable.
      */
    function getPrice(address asset) public view virtual returns (uint);
} 
