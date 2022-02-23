// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./Comet.sol";
import "./CometConfiguration.sol";

contract CometFactory is CometConfiguration {
    function clone(Configuration memory config) external returns (address) {
        return address(new Comet(config));
    }
}