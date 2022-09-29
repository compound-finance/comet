// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "../munged/Comet.sol";
import "../munged/ERC20.sol";
import "../munged/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title Certora's comet harness getters contract
 * @notice Getters only NO SIMPLIFICATIONS
 * @author Certora
 */
contract CometHarnessGetters is Comet {
    constructor(Configuration memory config) Comet(config) { }

    // Retrieves a user's balance of specific asset
    function getUserCollateralBalance(address user, address asset) public view returns (uint128) {
        return userCollateral[user][asset].balance;
    } 

    // Retrieves the value of pauseFlags from CometStorage
    function getPauseFlags() public view returns (uint8) {
        return pauseFlags;
    }

    // Retrieves the value of baseSupplyIndex from CometStorage
    function getBaseSupplyIndex() public view returns (uint64) {
        return baseSupplyIndex;
    }

    // Retrieves the value of baseBorrowIndex from CometStorage
    function getBaseBorrowIndex() public view returns (uint64) {
        return baseBorrowIndex;
    }

    // Retrieves the value of lastAccrualTime from CometStorage
    function getlastAccrualTime() public view returns (uint40) {
        return lastAccrualTime;
    }

    // Retrieves the value of totalSupplyBase from CometStorage
    function getTotalSupplyBase() public view returns (uint104) {
        return totalSupplyBase;
    }

    // Retrieves the value of totalBorrowBase from CometStorage
    function getTotalBorrowBase() public view returns (uint104) {
        return totalBorrowBase;
    }

    // Retrieves a user's assetsIn bitvector from CometStorage
    function getAssetinOfUser(address user) public view returns (uint16) {
        return userBasic[user].assetsIn;
    }

    // Retrieves a user's principal from CometStorage
    function getUserPrincipal(address user) public view returns (int104) {
        return userBasic[user].principal;
    }

    // Retrieves the offset of an asset in the array/bitvector
    // getAssetInfoByAddress to work with the maps instead of looping over the array
    mapping (address => uint8) public assetToIndex;
    function getAssetInfoByAddress(address asset) virtual override public view returns (AssetInfo memory){       
        AssetInfo memory assetInfo =  getAssetInfo(assetToIndex[asset]);
        // The require promises correlation of the asset values stored in assetInfo with the values retrieved form the index-asset map
        require (assetInfo.asset == asset);
        return assetInfo;
    }

    function getAssetOffsetByAsset(address asset) external view returns (uint8 offset) {
        AssetInfo memory assetInfo = getAssetInfoByAddress(asset);
        return assetInfo.offset;
    }

    // Retrieves the scale of an asset
    function getAssetScaleByAsset(address asset) external view returns (uint64 offset) {
        AssetInfo memory assetInfo = getAssetInfoByAddress(asset);
        return assetInfo.scale;
    }

    // Retrieves the totalSupplyAsset of an asset
    function getTotalsSupplyAsset(address asset) public view returns (uint128)  {
        return totalsCollateral[asset].totalSupplyAsset;
    }

    // Retrieves the supplyCap of an asset
    function getAssetSupplyCapByAddress(address asset) external view returns (uint128){
         AssetInfo memory assetInfo = getAssetInfoByAddress(asset);
        return assetInfo.supplyCap;
        
    }

    // Retrieves the liquidateCollateralFactor of an asset
    function getLiquidateCollateralFactor(address asset) public view returns (uint64)  {
        AssetInfo memory assetInfo = super.getAssetInfoByAddress(asset);
        return assetInfo.liquidateCollateralFactor;
    }    

    // Retrieves the borrowCollateralFactor of an asset
    function getBorrowCollateralFactor(address asset) public view returns (uint64)  {
        AssetInfo memory assetInfo = super.getAssetInfoByAddress(asset);
        return assetInfo.borrowCollateralFactor;
    }    

    // Retrieves a user's ERC20 token's balance
    function tokenBalanceOf(address token, address user) external view returns(uint256) {
        return ERC20(token).balanceOf(user);
    }

    // Retrieve BASE_INDEX_SCALE
    function getBaseIndexScale() external pure returns (uint64) {
        return BASE_INDEX_SCALE;
    }

    // Retrieve FACTOR_SCALE
    function getFactorScale() external pure returns (uint64) {
        return FACTOR_SCALE;
    }
    

    // Retrieve asset00_a
    function getAsset00_a() external view returns (uint256){
        return asset00_a;
    }

    // Retrieve asset00_b
    function getAsset00_b() external view returns (uint256){
        return asset00_b;
    }

    // Retrieve getAccrualDescaleFactor
    function getAccrualDescaleFactor() external view returns (uint256) {
        return accrualDescaleFactor;
    } 
    
    // Retrieve a user's present value from principal value
    function baseBalanceOf(address account) external view returns (int256) {
        return presentValue(userBasic[account].principal);
    }
    
    // External wrapper for hasPermission
    function call_hasPermission(address owner, address manager) external view returns (bool) {
        return hasPermission(owner, manager);
    }

}
