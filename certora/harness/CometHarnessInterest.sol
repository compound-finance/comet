// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

// import "./CometHarnessGetters.sol";
import "./CometHarnessWrappers.sol";
import "../../contracts/ERC20.sol";
import "../../contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Certora's comet harness interest contract
 * @notice harness for interest computations
 * @author Certora
 */
contract CometHarnessInterest is CometHarnessWrappers {
    constructor(Configuration memory config) CometHarnessWrappers(config) { }

    // function getSpecificSupplyRateInternal(uint64 _baseSupplyIndex, uint64 _baseBorrowIndex, uint64 _trackingSupplyIndex, uint64 _trackingBorrowIndex) public view returns (uint64){
    //     TotalsBasic memory totalsBasic1 = 
    //     TotalsBasic ({
    //         baseSupplyIndex: _baseSupplyIndex,
    //         baseBorrowIndex: _baseBorrowIndex,
    //         trackingSupplyIndex: _trackingSupplyIndex,
    //         trackingBorrowIndex: _trackingBorrowIndex,
    //         totalSupplyBase: totalSupplyBase,
    //         totalBorrowBase: totalBorrowBase,
    //         lastAccrualTime: lastAccrualTime,
    //         pauseFlags: pauseFlags
    //     });
    //     return getSupplyRate();
    // }

    // function getSpecificBorrowRateInternal(uint64 _baseSupplyIndex, uint64 _baseBorrowIndex, uint64 _trackingSupplyIndex, uint64 _trackingBorrowIndex) public view returns (uint64){
    //     TotalsBasic memory totalsBasic1 = 
    //     TotalsBasic ({
    //         baseSupplyIndex: _baseSupplyIndex,
    //         baseBorrowIndex: _baseBorrowIndex,
    //         trackingSupplyIndex: _trackingSupplyIndex,
    //         trackingBorrowIndex: _trackingBorrowIndex,
    //         totalSupplyBase: totalSupplyBase,
    //         totalBorrowBase: totalBorrowBase,
    //         lastAccrualTime: lastAccrualTime,
    //         pauseFlags: pauseFlags
    //     });
    //     return getBorrowRate();
    // }

    // function getSpecificUtilizationInternal(uint64 _baseSupplyIndex, uint64 _baseBorrowIndex, uint64 _trackingSupplyIndex, uint64 _trackingBorrowIndex) public view returns (uint){
    //     TotalsBasic memory totalsBasic1 = 
    //     TotalsBasic ({
    //         baseSupplyIndex: _baseSupplyIndex,
    //         baseBorrowIndex: _baseBorrowIndex,
    //         trackingSupplyIndex: _trackingSupplyIndex,
    //         trackingBorrowIndex: _trackingBorrowIndex,
    //         totalSupplyBase: totalSupplyBase,
    //         totalBorrowBase: totalBorrowBase,
    //         lastAccrualTime: lastAccrualTime,
    //         pauseFlags: pauseFlags
    //     });
    //     return getUtilization();
    // }

    function factorScale() public view returns (uint64){
        return FACTOR_SCALE;
    }
}
