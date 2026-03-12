// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometWithCOMPDelegation.sol";
import "./CometConfiguration.sol";

contract CometFactoryWithCOMPDelegation is CometConfiguration {
    function clone(Configuration calldata config) external returns (address) {
        return address(new CometWithCOMPDelegation(config));
    }
}
