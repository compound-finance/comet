// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./Configurator.sol";
import "./MockProtocol.sol";

contract ProtocolFactory {

    event NewProtocol(address newProtocol);

    Configurator immutable configurator;

    constructor(address configurator_) {
        configurator = Configurator(configurator_);
    }

    function createProtocol() external returns (address) {
        MockProtocol protocol = new MockProtocol(configurator.targetReserves(), configurator.borrowMin());
        emit NewProtocol(address(configurator));
        return address(protocol);
    }
}