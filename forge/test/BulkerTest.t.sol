// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../../contracts/Comet.sol";
import "../../contracts/CometInterface.sol";
import "../../contracts/bulkers/MainnetBulker.sol";

// Convert an hexadecimal character to their value
function fromHexChar(uint8 c) returns (uint8) {
    if (bytes1(c) >= bytes1('0') && bytes1(c) <= bytes1('9')) {
        return c - uint8(bytes1('0'));
    }
    if (bytes1(c) >= bytes1('a') && bytes1(c) <= bytes1('f')) {
        return 10 + c - uint8(bytes1('a'));
    }
    if (bytes1(c) >= bytes1('A') && bytes1(c) <= bytes1('F')) {
        return 10 + c - uint8(bytes1('A'));
    }
    revert("fail");
}

// Convert an hexadecimal string to raw bytes
function fromHex(string memory s) returns (bytes memory) {
    bytes memory ss = bytes(s);
    require(ss.length%2 == 0); // length must be even
    bytes memory r = new bytes(ss.length/2);
    for (uint i=0; i<ss.length/2; ++i) {
        r[i] = bytes1(fromHexChar(uint8(ss[2*i])) * 16 +
                    fromHexChar(uint8(ss[2*i+1])));
    }
    return r;
}
contract BulkerTest is Test {
    function setUp() public {
        vm.createSelectFork(string.concat("https://goerli.infura.io/v3/", vm.envString("INFURA_KEY")));
    }

    function testTest() public {
        address kevin = 0x1C2C3c2E3232080e0738187520372e30Ce2e34CB;
        // address bulker = 0x93817B582248F563D5d19923Bd5B92b045794668;
        MainnetBulker bulker = new MainnetBulker(
            0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399,
            payable(0x42a71137C09AE83D8d05974960fd607d40033499),
            0x4942BBAf745f235e525BAff49D31450810EDed5b
        );

        vm.prank(kevin);
        CometInterface(payable(0x9A539EEc489AAA03D588212a164d0abdB5F08F5F)).approve(
            address(bulker),
            type(uint256).max
        );

        address weth9 = 0x42a71137C09AE83D8d05974960fd607d40033499;
        // address cometImpl = 0x42a71137C09AE83D8d05974960fd607d40033499;

        vm.label(weth9, "weth9");
        vm.label(kevin, "Kevin");
        // vm.label(cometImpl, "cometImpl");

        vm.prank(kevin);
        // MainnetBulker(payable(bulker)).call(
        address(bulker).call(
            fromHex(
                "555029a6000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001414354494f4e5f57495448445241575f4e41544956455f544f4b454e000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000600000000000000000000000009a539eec489aaa03d588212a164d0abdb5f08f5f0000000000000000000000001c2c3c2e3232080e0738187520372e30ce2e34cbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            )
        );
    }
}