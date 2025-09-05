import { ethers, expect, exp, makeProtocol } from './helpers';

describe('CometWithPartialLiquidation', function() {
  it('should demonstrate partial liquidation with CometHarness', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1500, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1500, 18));
    await cometWithPartialLiquidation.setCollateralBalance(
      ethers.constants.AddressZero,
      COMP.address, 
      exp(10000, 18)
    );

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 1000n,
      totalBorrowBase: exp(1500, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11500, 18),
      _reserved: 0n,
    });

    const userBasic = await cometWithPartialLiquidation.userBasic(user1.address);
    const assetInfoInitial = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
    const isAssetInInitial = (userBasic.assetsIn & (1 << assetInfoInitial.offset)) !== 0;
    expect(isAssetInInitial).to.be.true;

    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    expect(isLiquidatable).to.be.true;

    const initialCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);

    try {
      const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
      await absorbTx.wait();
      
      const finalCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
      const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
      const finalUserBasic = await cometWithPartialLiquidation.userBasic(user1.address);
      
      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      expect(finalCollateral.balance.toBigInt()).to.be.gt(0n);
      
      const assetInfoFinal = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
      const isAssetInFinal = (finalUserBasic.assetsIn & (1 << assetInfoFinal.offset)) !== 0;
      
      if (finalCollateral.balance.toBigInt() === 0n) {
        expect(isAssetInFinal).to.be.false;
      } else {
        expect(isAssetInFinal).to.be.true;
      }
      
    } catch (error) {
      if (error.message.includes('Division or modulo division by zero')) {
        const userBasicError = await cometWithPartialLiquidation.userBasic(user1.address);
        const userCollateralError = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
        const assetInfoError = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
        const priceError = await cometWithPartialLiquidation.getPrice(assetInfoError.priceFeed);
        
        const collateralValueError = (userCollateralError.balance.toBigInt() * priceError.toBigInt()) / (10n ** 18n);
        const collaterizationValueError = (collateralValueError * assetInfoError.borrowCollateralFactor.toBigInt()) / (10n ** 18n);
        const liquidationValueError = (collateralValueError * assetInfoError.liquidationFactor.toBigInt()) / (10n ** 18n);
        
        const targetHF = 1n * (10n ** 18n);
        const denominator1 = (assetInfoError.borrowCollateralFactor.toBigInt() * targetHF) / (10n ** 18n) - assetInfoError.liquidationFactor.toBigInt();
        const denominator2 = collaterizationValueError - liquidationValueError;
        
        if (denominator1 === 0n || denominator2 === 0n) {
          throw new Error('Division by zero detected in absorb function');
        }
      }
      throw error;
    }
  });

  it('should return false when user has no debt', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, 0);
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));

    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    expect(isLiquidatable).to.be.false;

    // Try to absorb - should fail because user is not liquidatable
    try {
      const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
      await absorbTx.wait();
      expect.fail('Absorb should have failed because user is not liquidatable');
    } catch (error) {
      expect(error.message).to.include('NotLiquidatable');
    }
  });

  it('should return false when user has deposit', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, exp(1000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));

    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    expect(isLiquidatable).to.be.false;

    // Try to absorb - should fail because user is not liquidatable
    try {
      const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
      await absorbTx.wait();
      expect.fail('Absorb should have failed because user is not liquidatable');
    } catch (error) {
      expect(error.message).to.include('NotLiquidatable');
    }
  });

  it('should return false when user has sufficient collateral for debt', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1] } = protocol;
    const { COMP } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(2000, 18));

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(2000, 18),
      _reserved: 0n,
    });

    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    expect(isLiquidatable).to.be.false;
  });

  it('should return true when user has insufficient collateral for debt', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(500, 18));
    await cometWithPartialLiquidation.setCollateralBalance(
      ethers.constants.AddressZero,
      COMP.address, 
      exp(10000, 18)
    );

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10500, 18),
      _reserved: 0n,
    });

    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    expect(isLiquidatable).to.be.true;

    // Try to absorb - should succeed because user is liquidatable
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();

    // Verify liquidation occurred
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(finalDebt.toBigInt()).to.be.lt(exp(1000, 6).toBigInt());
    expect(finalCollateral.balance.toBigInt()).to.be.lt(exp(500, 18).toBigInt());
    expect(finalIsLiquidatable).to.be.false; // Should be fully liquidated
  });

  it('should successfully absorb user with single collateral', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(2000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1500, 18));
    await cometWithPartialLiquidation.setCollateralBalance(
      ethers.constants.AddressZero,
      COMP.address, 
      exp(10000, 18)
    );

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(2000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11500, 18),
      _reserved: 0n,
    });

    const initialCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(isLiquidatable).to.be.true;

    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();

    const finalCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    expect(finalCollateral.balance.toBigInt()).to.be.lt(initialCollateral.balance.toBigInt());
    expect(finalIsLiquidatable).to.be.false;
  });

  it('should successfully absorb user with multiple collaterals', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000,
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
          liquidationFactor: exp(0.65, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP, WETH } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(3000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(1, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(3000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11000, 18),
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(101, 18),
      _reserved: 0n,
    });

    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(isLiquidatable).to.be.true;

    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();

    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    const compReduced = finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt();
    const wethReduced = finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt();
    expect(compReduced || wethReduced).to.be.true;
    
    expect(finalIsLiquidatable).to.be.true;
  });

  it('should successfully absorb user with multiple collaterals - sufficient last collateral only', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000,
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
          liquidationFactor: exp(0.65, 18),
        },
        WBTC: {
          initial: 1e7,
          decimals: 8,
          initialPrice: 50000,
          borrowCF: exp(0.7, 18),
          liquidateCF: exp(0.75, 18),
          liquidationFactor: exp(0.6, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP, WETH, WBTC } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(200, 18));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(0.2, 18));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WBTC.address, exp(1, 8));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WBTC.address, exp(100, 8));

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10200, 18),
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(100.2, 18),
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WBTC.address, {
      totalSupplyAsset: exp(101, 8),
      _reserved: 0n,
    });

    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const initialWBTC = await cometWithPartialLiquidation.userCollateral(user1.address, WBTC.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(isLiquidatable).to.be.false; // Should be false because last collateral is sufficient

    // Try to absorb - should fail because user is not liquidatable
    try {
      const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
      await absorbTx.wait();
      expect.fail('Absorb should have failed because user is not liquidatable');
    } catch (error) {
      expect(error.message).to.include('NotLiquidatable');
    }
  });

  it('should successfully absorb user with multiple collaterals - insufficient last collateral', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000,
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
          liquidationFactor: exp(0.65, 18),
        },
        WBTC: {
          initial: 1e7,
          decimals: 8,
          initialPrice: 50000,
          borrowCF: exp(0.7, 18),
          liquidateCF: exp(0.75, 18),
          liquidationFactor: exp(0.6, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP, WETH, WBTC } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(200, 18));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(0.2, 18));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WBTC.address, exp(0.002, 8));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WBTC.address, exp(100, 8));

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10200, 18),
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(100.2, 18),
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WBTC.address, {
      totalSupplyAsset: exp(100.002, 8),
      _reserved: 0n,
    });

    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const initialWBTC = await cometWithPartialLiquidation.userCollateral(user1.address, WBTC.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(isLiquidatable).to.be.true; // Should be true because all collaterals are insufficient

    // Perform absorption
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();

    // Check final state
    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const finalWBTC = await cometWithPartialLiquidation.userCollateral(user1.address, WBTC.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    // Verify liquidation occurred - debt should be reduced
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    // At least one collateral should be reduced
    const compReduced = finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt();
    const wethReduced = finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt();
    const wbtcReduced = finalWBTC.balance.toBigInt() < initialWBTC.balance.toBigInt();
    expect(compReduced || wethReduced || wbtcReduced).to.be.true;
    
    // User should still be liquidatable (partial liquidation with insufficient collaterals)
    expect(finalIsLiquidatable).to.be.true;
  });

  it('should successfully absorb user with insufficient collaterals', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000,
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
          liquidationFactor: exp(0.65, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP, WETH } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(300, 18));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(0.2, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10300, 18),
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(100.2, 18),
      _reserved: 0n,
    });

    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(isLiquidatable).to.be.true;

    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();

    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    const compReduced = finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt();
    const wethReduced = finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt();
    expect(compReduced || wethReduced).to.be.true;
    
    expect(finalIsLiquidatable).to.be.true;
  });

  it('should perform full liquidation with single collateral', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));

    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11000, 18),
      _reserved: 0n,
    });

    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(isLiquidatable).to.be.true;

    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();

    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(finalDebt.toBigInt()).to.equal(0n);
    expect(finalCOMP.balance.toBigInt()).to.equal(0n);
    expect(finalIsLiquidatable).to.be.false;
  });
});
