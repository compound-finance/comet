// SPDX-License-Identifier: ADD VALID LICENSE
pragma solidity ^0.8.0;

contract Comet {
    struct Configuration {
        address governor;
        address priceOracle;
        address baseToken;
    }

    // Configuration constants
    address public immutable governor;
    address public immutable priceOracle;
    address public immutable baseToken;

    constructor(Configuration memory config) {
        // Set configuration variables
        governor = config.governor;
        priceOracle = config.priceOracle;
        baseToken = config.baseToken;
    }
}
