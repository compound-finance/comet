// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../../contracts/Comet.sol";
import "../../contracts/CometConfiguration.sol";

contract CometTest is Test {
    Comet public comet;

    function setUp() public {
        // XXX
    }

    function testFailXXX() public {
        CometConfiguration.AssetConfig[] memory assets = new CometConfiguration.AssetConfig[](0);
        CometConfiguration.Configuration memory config =
            CometConfiguration.Configuration(address(0),
                          address(0),
                          address(0),
                          address(0),
                          address(0),
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          0,
                          assets);
        comet = new Comet(config);
    }
}
