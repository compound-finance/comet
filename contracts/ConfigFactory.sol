// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./Config.sol";

contract ConfigFactory {

    event NewConfig(address newConfig);

    function createConfig(uint targetReserves, uint borrowMin) external returns (address) {
        Config config = new Config(targetReserves, borrowMin);

        emit NewConfig(address(config));

        return address(config);
    }
}