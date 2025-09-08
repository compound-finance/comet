import { ethers, expect, exp, makeProtocol } from './helpers';
import {
  CometInterface
} from '../build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

async function borrowCapacityForAsset(comet: CometInterface, actor: SignerWithAddress, assetIndex: number) {
  const {
    asset: collateralAssetAddress,
    borrowCollateralFactor,
    priceFeed,
    scale
  } = await comet.getAssetInfo(assetIndex);

  const userCollateral = await comet.collateralBalanceOf(
    actor.address,
    collateralAssetAddress
  );
  const price = await comet.getPrice(priceFeed);

  const factorScale = await comet.factorScale();
  const priceScale = await comet.priceScale();
  const baseScale = await comet.baseScale();

  const collateralValue = (userCollateral.mul(price)).div(scale);
  return collateralValue.mul(borrowCollateralFactor).mul(baseScale).div(factorScale).div(priceScale);
}

describe('CometWithPartialLiquidation', function() {
  it.only('should demonstrate partial liquidation', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: {
          initial: exp(1e6, 6),
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: exp(1e6, 18),
          decimals: 18,
          initialPrice: 50,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
          supplyCap: exp(2e5, 18),
        },
        USDT: {
          initial: exp(1e6, 6),
          decimals: 6,
          initialPrice: 1,
          borrowCF: exp(0.9, 18),
          liquidateCF: exp(0.95, 18),
          liquidationFactor: exp(0.8, 18),
          supplyCap: exp(2e5, 6),
        },
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });
    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, userToLiquidate] } = protocol;
    const { USDC, COMP, USDT } = tokens;
    const { USDC: priceFeedUSDC, COMP: priceFeedCOMP, USDT: priceFeedUSDT } = priceFeeds;

    await USDC.connect(governor).transfer(user1.address, exp(8000, 6));
    await USDC.connect(user1).approve(cometWithPartialLiquidation.address, exp(8000, 6));
    await cometWithPartialLiquidation.connect(user1).supply(USDC.address, exp(8000, 6));

    await COMP.connect(governor).transfer(userToLiquidate.address, exp(100, 18));
    await COMP.connect(userToLiquidate).approve(cometWithPartialLiquidation.address, exp(100, 18));
    await cometWithPartialLiquidation.connect(userToLiquidate).supply(COMP.address, exp(100, 18));
    
    await USDT.connect(governor).transfer(userToLiquidate.address, exp(100, 6));
    await USDT.connect(userToLiquidate).approve(cometWithPartialLiquidation.address, exp(100, 6));
    await cometWithPartialLiquidation.connect(userToLiquidate).supply(USDT.address, exp(100, 6));
    
    await cometWithPartialLiquidation.connect(userToLiquidate).withdraw(COMP.address, exp(100, 18));
    
    const borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, userToLiquidate, 0);
    const borrowCapacityUSDT = await borrowCapacityForAsset(cometWithPartialLiquidation, userToLiquidate, 1);
    const borrowCapacity = borrowCapacityCOMP.add(borrowCapacityUSDT);
    console.log(`Borrow Capacity: ${borrowCapacity} USDC`);
    await cometWithPartialLiquidation.connect(userToLiquidate).withdraw(USDC.address, borrowCapacity);
    expect(await cometWithPartialLiquidation.borrowBalanceOf(userToLiquidate.address)).to.equal(borrowCapacity);

    let iterations = 0;
    while(!(await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address)) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(95).div(100), // Decrease price by 5%
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );
      const currentUSDTData = await priceFeedUSDT.latestRoundData();
      await priceFeedUSDT.connect(governor).setRoundData(
        currentUSDTData._roundId,
        currentUSDTData._answer.mul(98).div(100), // Decrease price by 2%
        currentUSDTData._startedAt,
        currentUSDTData._updatedAt,
        currentUSDTData._answeredInRound
      );

      // advance time by 1 week
      await ethers.provider.send('evm_increaseTime', [31 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }
    expect(await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address)).to.be.true;
    const userBasicBefore = await cometWithPartialLiquidation.userBasic(userToLiquidate.address);
    console.log('User basic before:', userBasicBefore);
    await cometWithPartialLiquidation.connect(user1).absorb(user1.address, [userToLiquidate.address]);
    const userBasicAfter = await cometWithPartialLiquidation.userBasic(userToLiquidate.address);
    console.log('User basic after:', userBasicAfter);

    // await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1500, 6));
    // await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1500, 18));
    // await cometWithPartialLiquidation.setCollateralBalance(
    //   ethers.constants.AddressZero,
    //   COMP.address, 
    //   exp(10000, 18)
    // );

    // await cometWithPartialLiquidation.setTotalsBasic({
    //   baseSupplyIndex: exp(1, 15),
    //   baseBorrowIndex: exp(1, 15),
    //   trackingSupplyIndex: exp(1, 15),
    //   trackingBorrowIndex: exp(1, 15),
    //   totalSupplyBase: 1000n,
    //   totalBorrowBase: exp(1500, 6),
    //   lastAccrualTime: Math.floor(Date.now() / 1000),
    //   pauseFlags: 0,
    // });

    // await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
    //   totalSupplyAsset: exp(11500, 18),
    //   _reserved: 0n,
    // });

    // const userBasic = await cometWithPartialLiquidation.userBasic(user1.address);
    // const assetInfoInitial = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
    // const isAssetInInitial = (userBasic.assetsIn & (1 << assetInfoInitial.offset)) !== 0;
    // expect(isAssetInInitial).to.be.true;

    // const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    // expect(isLiquidatable).to.be.true;

    // const initialCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    // const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);

    // try {
    //   const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    //   await absorbTx.wait();
      
    //   const finalCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    //   const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    //   const finalUserBasic = await cometWithPartialLiquidation.userBasic(user1.address);
      
    //   expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    //   expect(finalCollateral.balance.toBigInt()).to.be.gt(0n);
      
    //   const assetInfoFinal = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
    //   const isAssetInFinal = (finalUserBasic.assetsIn & (1 << assetInfoFinal.offset)) !== 0;
      
    //   if (finalCollateral.balance.toBigInt() === 0n) {
    //     expect(isAssetInFinal).to.be.false;
    //   } else {
    //     expect(isAssetInFinal).to.be.true;
    //   }
      
    // } catch (error) {
    //   if (error.message.includes('Division or modulo division by zero')) {
    //     const userBasicError = await cometWithPartialLiquidation.userBasic(user1.address);
    //     const userCollateralError = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    //     const assetInfoError = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
    //     const priceError = await cometWithPartialLiquidation.getPrice(assetInfoError.priceFeed);
        
    //     const collateralValueError = (userCollateralError.balance.toBigInt() * priceError.toBigInt()) / (10n ** 18n);
    //     const collaterizationValueError = (collateralValueError * assetInfoError.borrowCollateralFactor.toBigInt()) / (10n ** 18n);
    //     const liquidationValueError = (collateralValueError * assetInfoError.liquidationFactor.toBigInt()) / (10n ** 18n);
        
    //     const targetHF = 1n * (10n ** 18n);
    //     const denominator1 = (assetInfoError.borrowCollateralFactor.toBigInt() * targetHF) / (10n ** 18n) - assetInfoError.liquidationFactor.toBigInt();
    //     const denominator2 = collaterizationValueError - liquidationValueError;
        
    //     if (denominator1 === 0n || denominator2 === 0n) {
    //       throw new Error('Division by zero detected in absorb function');
    //     }
    //   }
    //   throw error;
    // }
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
    
    expect(finalDebt.toBigInt()).to.be.lt(exp(1000, 6));
    expect(finalCollateral.balance.toBigInt()).to.be.lt(exp(500, 18));
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

    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(3000, 6));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(200, 18));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(0.2, 18));
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WBTC.address, exp(0.02, 8));
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
    
    
    expect(isLiquidatable).to.be.true; 

    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();

    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const finalWBTC = await cometWithPartialLiquidation.userCollateral(user1.address, WBTC.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    const compReduced = finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt();
    const wethReduced = finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt();
    const wbtcReduced = finalWBTC.balance.toBigInt() < initialWBTC.balance.toBigInt();
    expect(compReduced || wethReduced || wbtcReduced).to.be.true;
    
    expect(finalIsLiquidatable).to.be.true;
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
