methods{
    // getAssetInfo(uint) returns (AssetInfo)
    // assets() returns (AssetInfo[])
    assetAddresses() returns (address[])
    getNow() returns (uint40)
    accrue()
    allow(address, bool)
    allowBySig(address, address, bool, uint256, uint256, uint8, bytes32, bytes32)
    hasPermission(address, address) returns (bool)
    getSupplyRate() returns (uint64)
    getBorrowRate() returns (uint64)
    getUtilization() returns (uint)
    pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused)
    isSupplyPaused() returns (bool) envfree
    isTransferPaused() returns (bool) envfree
    isWithdrawPaused() returns (bool) envfree
    isAbsorbPaused() returns (bool) envfree
    isBuyPaused() returns (bool) envfree
    baseBalanceOf(address)
    collateralBalanceOf(address, address)
    supply(address, uint)
    supplyTo(address, address, uint)
    supplyFrom(address, address, address, uint)
    transfer(address, address, uint)
    transferFrom(address, address, address, uint)
    withdraw(address, uint)
    withdrawTo(address, address, uint)
    withdrawFrom(address, address, address, uint)
    getPrice(address) returns (uint)
    getReserves() returns (int)
    buyCollateral(address, uint, uint, address)
    quoteCollateral(address, uint) returns (uint)
    isBorrowCollateralized(address) returns (bool)
    getBorrowLiquidity(address) returns (int)
    getLiquidationMargin(address) returns (int)
    isLiquidatable(address) returns (bool)

    // self generated getters
    governor() envfree
    pauseGuardian() envfree
}

function envNotZero(env e){
    require e.block.timestamp != 0;
    require e.msg.sender != 0;
    require e.msg.value != 0;
}