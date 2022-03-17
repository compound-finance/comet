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
        return pauseFlags;
    }

    function getTotalBaseSupplyIndex() public view returns (uint64) {
        return baseSupplyIndex;
    }

    function getTotalBaseBorrowIndex() public view returns (uint64) {
        return baseBorrowIndex;
    }
    function getlastAccrualTime() public view returns (uint40) {
        return lastAccrualTime;
    }

    function getTotalSupplyBase() public view returns (uint104) {
        return totalSupplyBase;
    }

    function getTotalBorrowBase() public view returns (uint104) {
        return totalBorrowBase;
    }

    function getAssetinOfUser(address user) public view returns (uint16) {
        return userBasic[user].assetsIn;
    }

    function getPrincipal(address user) public view returns (int104) {
        return userBasic[user].principal;
    }

    function getAssetOffsetByAsset(address asset) external view returns (uint8 offset) {
        AssetInfo memory assetInfo = super.getAssetInfoByAddress(asset);
        return assetInfo.offset;
    }
    function getAssetScaleByAsset(address asset) external view returns (uint64 offset) {
        AssetInfo memory assetInfo = super.getAssetInfoByAddress(asset);
        return assetInfo.scale;
    }

    function getTotalsSupplyAsset(address asset) public view returns (uint128)  {
        return totalsCollateral[asset].totalSupplyAsset;
    }
    function getLiquidateCollateralFactor(address asset) public view returns (uint64)  {
        AssetInfo memory assetInfo = super.getAssetInfoByAddress(asset);
        return assetInfo.liquidateCollateralFactor;
    }    

    function getBorrowCollateralFactor(address asset) public view returns (uint64)  {
        AssetInfo memory assetInfo = super.getAssetInfoByAddress(asset);
        return assetInfo.borrowCollateralFactor;
    }    

    function getUserCollateralBalanceByAsset(address user, address asset) public view returns (uint128) {
        return userCollateral[user][asset].balance;
    }

    function tokenBalanceOf(address token, address user) external view returns(uint256) {
        return ERC20(token).balanceOf(user);
    }

    function baseIndexScale() public returns (uint64) {
        return BASE_INDEX_SCALE;
    }
     
    function baseBalanceOf(address account) public returns (int104) {
        (bool success, bytes memory result) = extensionDelegate.delegatecall(
            abi.encodeWithSignature("baseBalanceOf(address)", account));
        require(success);
        return abi.decode(result, (int104));
    }

    function getGovernor() public view returns (address) {
        return governor;
    }

    function getPauseGuardian() public view returns (address) {
        return pauseGuardian;
    }
    
}