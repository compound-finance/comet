// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "../Comet.sol";

contract CometHarness is Comet {
    uint public nowOverride;

    constructor(Configuration memory config) Comet(config) {}

    function getNow() override public view returns (uint40) {
        return nowOverride > 0 ? uint40(nowOverride) : uint40(block.timestamp);
    }

    function setNow(uint now_) public {
        nowOverride = now_;
    }

    function setTotals(Totals memory totals_) public {
        totals = totals_;
    }
}