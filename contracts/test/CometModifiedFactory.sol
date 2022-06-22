// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.13;

import "./CometModified.sol";
import "../CometConfiguration.sol";

contract CometFactory is CometConfiguration {
    function clone(Configuration calldata config) external returns (address) {
        return address(new CometModified(config));
    }
}