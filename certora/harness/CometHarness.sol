// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../../contracts/Comet.sol";
import "./CometHarnessWrappers.sol";

import "../../contracts/ERC20.sol";
import "../../contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Certora's comet summarization contract
 * @notice 
 * @author Certora
 */
contract CometHarness is CometHarnessWrappers {
    constructor(Configuration memory config) CometHarnessWrappers(config) {
    }

    // summarization/harness for global collateral asset    
    mapping (address => uint8) public asset_index;
    mapping (uint8 => address) public index_asset;
    mapping (uint8 => AssetInfo) public asset_info;


    function getAssetInfo(uint8 i) override public view returns (AssetInfo memory){
        AssetInfo memory assetInfo = asset_info[i];
        require (assetInfo.offset == i);
        require (assetInfo.asset == index_asset[i]);
        return assetInfo;
    }

    function getAssetInfoByAddress(address asset) override internal view returns (AssetInfo memory){
        return getAssetInfo(asset_index[asset]);
    }

    function get_Index_Of_Collateral_Asset(address asset) public view returns (uint8){
        return asset_index[asset];
    }

    function get_Collateral_Asset_By_Index(uint8 index) public view returns (address){
        return index_asset[index];
    }

    // summarization/harness for user collateral asset 
    mapping (uint16 => mapping (address => bool)) asset_in_state; 
    mapping (uint16 => mapping (address => mapping (bool => uint16))) asset_in_state_changes; 

    // [ , , , , , , , ] => index => T/F  -------  asset_in_state
    // [ , , , , , , T, ] => index => F/T => [ , , , , , , F, ] -------  asset_in_state_changes
    // uint16   before = user.assetIn
    // after = asset_in_state_chages[before][T1][true]
    // forall T!=T1 asset_in_state[before,T] == asset_in_state[after,T]
    function isInAsset(uint16 assetsIn, uint8 assetOffset) override internal view returns (bool) {
        return asset_in_state[assetsIn][index_asset[assetOffset]];
    }

    function call_Summarized_IsInAsset(uint16 assetsIn, uint8 assetOffset) external view returns (bool) {
        return isInAsset(assetsIn, assetOffset);
    }

    /**
     * @dev Update assetsIn bit vector if user has entered or exited an asset
     */
    function updateAssetsIn(
        address account,
        address asset,
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
        assetInAfter = asset_in_state_changes[assetInBefore][asset][flag];
        userBasic[account].assetsIn = assetInAfter;
        require(asset_in_state[assetInAfter][asset] == flag);
    }

    uint256 nonDet1;
    uint256 nonDet2;
    function _getPackedAsset(AssetConfig[] memory assetConfigs, uint i) internal override view returns (uint256, uint256) {
        return (nonDet1,nonDet2);
    }

    /*********** Simplification ***********/
    /* under approximation (not taking into account all possible cases) */
    function accrue(TotalsBasic memory totals) internal override view returns (TotalsBasic memory) {
        return totals;
    }

    /* safe approximation? (taking into account all possible cases) */
    
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicSupplyRate;
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicBorrowRate;
    mapping( uint104 => mapping (uint104 => uint64 ))  symbolicUtilization;
    

    function getSupplyRateInternal(TotalsBasic memory totals) internal view virtual override returns (uint64) {
        return symbolicSupplyRate[totals.totalSupplyBase][totals.totalBorrowBase];
    }

    function getBorrowRateInternal(TotalsBasic memory totals) internal  virtual override view returns (uint64) {
        return symbolicBorrowRate[totals.totalSupplyBase][totals.totalBorrowBase];

    }
    
    function getUtilizationInternal(TotalsBasic memory totals) internal view override returns  (uint) {
        return symbolicUtilization[totals.totalSupplyBase][totals.totalBorrowBase];
    }


    function testTotalSupply() public view returns (uint104) {
        TotalsBasic memory totals = totalsBasic;
        totals = accrue(totals);
        uint104 totalSupplyBalance = presentValueSupply(totals, totals.totalSupplyBase);
        return totalSupplyBalance;
    }


    // function transferFrom(address src, address dst, address asset, uint amount) public override {
       
    // }

    function transferAssetFromBase(address src, address dst, address asset, uint amount) external {
        require (asset == baseToken);
        return this.transferAssetFrom(src, dst, asset, amount);
    }

    function transferFromAsset(address src, address dst, address asset, uint amount) external {
        require (asset != baseToken);
        return this.transferAssetFrom(src, dst, asset, amount);
    }


}
