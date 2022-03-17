methods{
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

    // Getters of public vars
    governor() returns (address) envfree
    pauseGuardian() returns (address) envfree
}

definition similarFunctions(method f) returns bool =    
            f.selector == withdraw(address,uint256).selector ||
            f.selector == withdrawTo(address,address,uint).selector ||
            f.selector == transferAsset(address,address,uint).selector ||
            f.selector == supplyTo(address,address,uint).selector ||
            f.selector == supply(address,uint).selector ||
            f.selector == initializeStorage().selector ;
