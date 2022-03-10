methods{
    // 0xc8c7fe6b envfree // getAssetInfo(uint8) returns (AssetInfo)
    getNow() returns (uint40)
    accrue()
    allow(address, bool)
    allowBySig(address, address, bool, uint256, uint256, uint8, bytes32, bytes32)
    hasPermission(address, address) returns (bool) envfree
    getSupplyRate() returns (uint64)
    getBorrowRate() returns (uint64)
    getUtilization() returns (uint)
    getPrice(address) returns (uint128)
    getReserves() returns (int)
    isBorrowCollateralized(address) returns (bool)
    getBorrowLiquidity(address) returns (int)
    isLiquidatable(address) returns (bool)
    getLiquidationMargin(address) returns (int)
    pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused)
    isSupplyPaused() returns (bool) envfree
    isTransferPaused() returns (bool) envfree
    isWithdrawPaused() returns (bool) envfree
    isAbsorbPaused() returns (bool) envfree
    isBuyPaused() returns (bool) envfree
    baseBalanceOf(address) returns (int104) envfree
    collateralBalanceOf(address, address) returns (uint128) envfree
    supply(address, uint)
    supplyTo(address, address, uint)
    supplyFrom(address, address, address, uint)
    transferAsset(address, address, uint)
    transferAssetFrom(address, address, address, uint)
    withdraw(address, uint)
    withdrawTo(address, address, uint)
    withdrawFrom(address, address, address, uint)
    absorb(address, address[])
    buyCollateral(address, uint, uint, address)
    quoteCollateral(address, uint) returns (uint)
    withdrawReserves(address, uint)

    // cometHarnessGetters
    getAssetinOfUser(address) returns (uint16) envfree
    getAssetOffsetByAsset(address) returns (uint8) envfree
}

// assumes some non-zero values on the environment
function envNotZero(env e){
    require e.block.timestamp != 0;
    require e.block.number != 0;
    require e.msg.sender != 0;
}