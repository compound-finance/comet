// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometGovAllow.sol";
import "./CometConfiguration.sol";

contract CometFactoryGovAllow is CometConfiguration {
    function clone(Configuration calldata config) external returns (address) {
        return address(new CometGovAllow(config));
    }
}