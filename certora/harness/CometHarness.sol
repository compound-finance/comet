// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../munged/Comet.sol";
import "./CometHarnessGetters.sol";

import "../munged/ERC20.sol";
import "../munged/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Certora's comet summarization contract
 * @notice A contract that holds summarizations and simplifications of methods and components of comet 
 * @author Certora
 */
contract CometHarness is CometHarnessGetters {
    constructor(Configuration memory config) CometHarnessGetters(config) {
    }

////////////////////////////////////////////////////////////////////////////////
/////////////////////////   global collateral asset   //////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
    // Safe summarization of assetInfo according to properties proven in assetInfo.spec
    // under the assumption that the constructor is called with unique assets 

    // Summarization of the assetConfigs array into maps that save:
    // 1. The index of each asset,
    // 2. The asset of each index,
    // 3. The AssetInfo of at each index

    mapping (uint8 => address) public indexToAsset;
    mapping (uint8 => AssetInfo) public assetInfoMap;

    // Overriding the original getAssetInfo to work with the maps rather than the original array.
    function getAssetInfo(uint8 i) override public view returns (AssetInfo memory){
        AssetInfo memory assetInfo = assetInfoMap[i];
        // The 2 requires are promising correlation of the asset and index values stored in assetInfo with the values retrieved form the index-asset mappings
        require (assetInfo.offset == i);
        require (assetInfo.asset == indexToAsset[i]);
        return assetInfo;
    }

    // Overriding the original getAssetInfoByAddress to work with the maps instead of looping over the array
    function getAssetInfoByAddress(address asset) override public view returns (AssetInfo memory){       
        AssetInfo memory assetInfo =  getAssetInfo(assetToIndex[asset]);
        // The require promises correlation of the asset values stored in assetInfo with the values retrieved form the index-asset map
        require (assetInfo.asset == asset);
        return assetInfo;
    }



////////////////////////////////////////////////////////////////////////////////
//////////////////////////   user collateral asset   ///////////////////////////
////////////////////////////////////////////////////////////////////////////////
// 
    /// Safe summarization of assetInfo according to properties proven in userCollateralAsset.spec
    // Summarization for assetIn bitvector. Saves assetIn info into maps:
    // 1. Given a bitvector and an asset determine if the bit is on or off (boolean)
    // 2. Given a bitvector, an asset and a boolean value that specify the supposed value of a specific asset, directs to the new bitvector that is formed.
    mapping (uint16 => mapping (address => bool)) assetInState;
    mapping (uint16 => mapping (address => mapping (bool => uint16))) assetInStateChanges; 

    // Overriding the original isInAsset to retrieve values from the assetInState mapping
    function isInAsset(uint16 assetsIn, uint8 assetOffset) override internal view returns (bool) {
        return assetInState[assetsIn][indexToAsset[assetOffset]];
    }

    // Wrapper that calls the the summarized isInAsset
    function callSummarizedIsInAsset(uint16 assetsIn, uint8 assetOffset) external view returns (bool) {
        return isInAsset(assetsIn, assetOffset);
    }

    // Overriding the original updateAssetsIn to use the assetIn bitvector summarization
    function updateAssetsIn(
        address account,
        AssetInfo memory assetInfo,
        uint128 initialUserBalance,
        uint128 finalUserBalance
    ) override internal {
        uint16 assetInBefore = userBasic[account].assetsIn;
        uint16 assetInAfter;
        bool flag;
        if (initialUserBalance == 0 && finalUserBalance != 0) {
            // set bit for asset
            flag = true;
        } else if (initialUserBalance != 0 && finalUserBalance == 0) {
            // clear bit for asset
            flag = false;
        }
        else{
            // skips the update
            return;
        }
        assetInAfter = assetInStateChanges[assetInBefore][assetInfo.asset][flag];
        userBasic[account].assetsIn = assetInAfter;
        // The 2 requires are promising correlation of the two assetIn mappings, and that isInAsset retrieve the correct value.
        require(assetInState[assetInAfter][assetInfo.asset] == flag);
        require(isInAsset(assetInAfter,assetToIndex[assetInfo.asset]) == flag ); 
    }


    // Over-approximation of _getPackedAsset to retrieve arbitrary values. The values are being tracked in global variables
    uint256 nonDet1;
    uint256 nonDet2;
    function getPackedAssetInternal(AssetConfig[] memory assetConfigs, uint i) internal override view returns (uint256, uint256) {
        return (nonDet1,nonDet2);
    }


    /*********** Simplification ***********/
    /* under approximation (not taking into account all possible cases) */
    //This is equiveleant to assuming that accure has been called on the current timestamp 
    // many properties of accrue are proven in interestComputation.spec
    bool public accrueWasCalled;
    function accrueInternal() override internal {
        bool accrued = accrueWasCalled;
        // This if statement is purely here to overcome compiler optimization.
        // The optimization removes the unused local assignment above.
        if (accrued) {
            uint x = 1 + 2;
            uint y = x + 3;
        }
    }

    function accruedInterestIndices(uint timeElapsed) override internal view returns (uint64, uint64) {
        bool accrued = accrueWasCalled;
        // This if statement is purely here to overcome compiler optimization.
        // The optimization removes the unused local assignment above.
        if(accrued) {
            return (getBaseSupplyIndex(), getBaseBorrowIndex());
        }
        return (getBaseSupplyIndex(), getBaseBorrowIndex());
    }

    /* Helpers: 
        A function to check if an address is registers, i.e, it has an assetInfo strcture 
    */  
    function isRegisterdAsAsset(address token) view external returns (bool) {
        return getAssetInfoByAddress(token).asset == token;
    }
}