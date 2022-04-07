// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometWithdraw.sol";
import "./CometConfiguration.sol";

contract CometFactoryWithdraw is CometConfiguration {
    function clone(Configuration calldata config) external returns (address) {
        return address(new CometWithdraw(config));
    }
}