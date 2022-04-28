// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometCore.sol";

/**
 * @title Compound's Comet Main Interface (without Ext)
 * @notice An efficient monolithic money market protocol
 * @author Compound
 */
abstract contract CometMainInterface is CometCore {
    event Supply(address indexed from, address indexed dst, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed src, address indexed to, uint256 amount);

    event SupplyCollateral(address indexed from, address indexed dst, address indexed asset, uint256 amount);
    event TransferCollateral(address indexed from, address indexed to, address indexed asset, uint256 amount);
    event WithdrawCollateral(address indexed src, address indexed to, address indexed asset, uint256 amount);

    event PauseAction(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused);
    event AbsorbDebt(address indexed absorber, address indexed borrower, uint104 debtAbsorbed, uint usdValue);
    event AbsorbCollateral(address indexed absorber, address indexed borrower, address indexed asset, uint128 collateralAbsorbed, uint usdValue);
    event BuyCollateral(address indexed buyer, address indexed asset, uint baseAmount, uint collateralAmount);

    function supply(address asset, uint amount) virtual external;
    function supplyTo(address dst, address asset, uint amount) virtual external;
    function supplyFrom(address from, address dst, address asset, uint amount) virtual external;

    function transfer(address dst, uint amount) virtual external returns (bool);
    function transferFrom(address src, address dst, uint amount) virtual external returns (bool);

    function transferAsset(address dst, address asset, uint amount) virtual external;
    function transferAssetFrom(address src, address dst, address asset, uint amount) virtual external;

    function withdraw(address asset, uint amount) virtual external;
    function withdrawTo(address to, address asset, uint amount) virtual external;
    function withdrawFrom(address src, address to, address asset, uint amount) virtual external;

    function approveThis(address manager, address asset, uint amount) virtual external;
    function withdrawReserves(address to, uint amount) virtual external;

    function absorb(address absorber, address[] calldata accounts) virtual external;
    function buyCollateral(address asset, uint minAmount, uint baseAmount, address recipient) virtual external;
    function quoteCollateral(address asset, uint baseAmount) virtual external view returns (uint);

    function getAssetInfo(uint8 i) virtual external view returns (AssetInfo memory);
    function getReserves() virtual external view returns (int);
    function getPrice(address priceFeed) virtual external view returns (uint128);

    function isBorrowCollateralized(address account) virtual external view returns (bool);
    function isLiquidatable(address account) virtual external view returns (bool);
    function getBorrowLiquidity(address account) virtual external view returns (int);
    function getLiquidationMargin(address account) virtual external view returns (int);

    function totalSupply() virtual external view returns (uint256);
    function balanceOf(address owner) virtual external view returns (uint256);
    function borrowBalanceOf(address account) virtual external view returns (uint256);

    function pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused) virtual external;
    function isSupplyPaused() virtual external view returns (bool);
    function isTransferPaused() virtual external view returns (bool);
    function isWithdrawPaused() virtual external view returns (bool);
    function isAbsorbPaused() virtual external view returns (bool);
    function isBuyPaused() virtual external view returns (bool);

    function accrueAccount(address account) virtual external;
    function getSupplyRate() virtual external view returns (uint64);
    function getBorrowRate() virtual external view returns (uint64);
    function getUtilization() virtual external view returns (uint);

    function governor() virtual external view returns (address);
    function pauseGuardian() virtual external view returns (address);
    function baseToken() virtual external view returns (address);
    function baseTokenPriceFeed() virtual external view returns (address);
    function extensionDelegate() virtual external view returns (address);

    function kink() virtual external view returns (uint);
    function perSecondInterestRateSlopeLow() virtual external view returns (uint);
    function perSecondInterestRateSlopeHigh() virtual external view returns (uint);
    function perSecondInterestRateBase() virtual external view returns (uint);
    function reserveRate() virtual external view returns (uint);
    function storeFrontPriceFactor() virtual external view returns (uint);

    function baseScale() virtual external view returns (uint);
    function trackingIndexScale() virtual external view returns (uint);

    function baseTrackingSupplySpeed() virtual external view returns (uint);
    function baseTrackingBorrowSpeed() virtual external view returns (uint);
    function baseMinForRewards() virtual external view returns (uint);
    function baseBorrowMin() virtual external view returns (uint);
    function targetReserves() virtual external view returns (uint);

    function numAssets() virtual external view returns (uint8);
    function decimals() virtual external view returns (uint8);

    function initializeStorage() virtual external;
}