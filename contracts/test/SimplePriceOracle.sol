// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "../PriceOracle.sol";

contract SimplePriceOracle is PriceOracle {
    mapping(address => uint) prices;

    function setPrice(address asset, uint price) public {
        prices[asset] = price;
    }

    /**
      * @notice Get the price of an asset
      * @param asset Address of token to get price of
      * @return The underlying asset price mantissa (scaled by 1e18).
      *  Zero means the price is unavailable.
      */
    function getPrice(address asset) public view override returns (uint) {
        return prices[asset];
    }
}