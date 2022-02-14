// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../../contracts/Comet.sol";
import "../../contracts/ERC20.sol";
import "../../contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Certora's comet harness getters contract
 * @notice Getters only NO SIMPLIFICATIONS
 * @author Certora
 */
contract CometHarnessGetters is Comet {
    constructor(Configuration memory config) Comet(config) { }

    function getUserCollateralBalance(address user, address asset) public view returns (uint128) {
        return userCollateral[user][asset].balance;
    } 
     
    function getPauseFlags() public view returns (uint8) {
        return totalsBasic.pauseFlags;
    }

    function getTotalBaseSupplyIndex() public view returns (uint64) {
        return totalsBasic.baseSupplyIndex;
    }

    function getTotalBaseBorrowIndex() public view returns (uint64) {
        return totalsBasic.baseBorrowIndex;
    }
    function getlastAccrualTime() public view returns (uint40) {
        return totalsBasic.lastAccrualTime;
    }

    function getTotalSupplyBase() public view returns (uint104) {
        return totalsBasic.totalSupplyBase;
    }

    function getTotalBorrowBase() public view returns (uint104) {
        return totalsBasic.totalBorrowBase;
    }

    function getAssetinOfUser(address user) public view returns (uint16) {
        return userBasic[user].assetsIn;
    }
}
