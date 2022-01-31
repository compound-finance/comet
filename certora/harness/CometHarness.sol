// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "../../contracts/Comet.sol";
import "./CometMathHarness.sol";
import "./CometStorageHarness.sol";
import "../../contracts/ERC20.sol";
import "../../contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Compound's Comet Contract
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
contract CometHarness is Comet, CometMathHarness, CometStorageHarness {
    constructor(Configuration memory config) Comet(config) {
    }
}
