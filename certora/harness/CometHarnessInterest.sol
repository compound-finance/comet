// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

import "./CometHarnessGetters.sol";
import "../../contracts/ERC20.sol";
import "../../contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Compound's Comet Contract
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
contract CometHarnessIntrest is CometHarnessGetters {
    constructor(Configuration memory config) CometHarnessGetters(config) { }

    function getSpecificSupplyRateInternal(uint64 _baseSupplyIndex, uint64 _baseBorrowIndex, uint64 _trackingSupplyIndex, uint64 _trackingBorrowIndex) public view returns (uint64){
        TotalsBasic memory totalsBasic1 = 
        TotalsBasic ({
            baseSupplyIndex: _baseSupplyIndex,
            baseBorrowIndex: _baseBorrowIndex,
            trackingSupplyIndex: _trackingSupplyIndex,
            trackingBorrowIndex: _trackingBorrowIndex,
            totalSupplyBase: totalsBasic.totalSupplyBase,
            totalBorrowBase: totalsBasic.totalBorrowBase,
            lastAccrualTime: totalsBasic.lastAccrualTime,
            pauseFlags: totalsBasic.pauseFlags
        });
        return getSupplyRateInternal(totalsBasic1);
    }

    function getSpecificBorrowRateInternal(uint64 _baseSupplyIndex, uint64 _baseBorrowIndex, uint64 _trackingSupplyIndex, uint64 _trackingBorrowIndex) public view returns (uint64){
        TotalsBasic memory totalsBasic1 = 
        TotalsBasic ({
            baseSupplyIndex: _baseSupplyIndex,
            baseBorrowIndex: _baseBorrowIndex,
            trackingSupplyIndex: _trackingSupplyIndex,
            trackingBorrowIndex: _trackingBorrowIndex,
            totalSupplyBase: totalsBasic.totalSupplyBase,
            totalBorrowBase: totalsBasic.totalBorrowBase,
            lastAccrualTime: totalsBasic.lastAccrualTime,
            pauseFlags: totalsBasic.pauseFlags
        });
        return getBorrowRateInternal(totalsBasic1);
    }

    function getSpecificUtilizationInternal(uint64 _baseSupplyIndex, uint64 _baseBorrowIndex, uint64 _trackingSupplyIndex, uint64 _trackingBorrowIndex) public view returns (uint){
        TotalsBasic memory totalsBasic1 = 
        TotalsBasic ({
            baseSupplyIndex: _baseSupplyIndex,
            baseBorrowIndex: _baseBorrowIndex,
            trackingSupplyIndex: _trackingSupplyIndex,
            trackingBorrowIndex: _trackingBorrowIndex,
            totalSupplyBase: totalsBasic.totalSupplyBase,
            totalBorrowBase: totalsBasic.totalBorrowBase,
            lastAccrualTime: totalsBasic.lastAccrualTime,
            pauseFlags: totalsBasic.pauseFlags
        });
        return getUtilizationInternal(totalsBasic1);
    }
}
