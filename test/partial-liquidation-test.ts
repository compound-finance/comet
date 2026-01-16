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

  it('should demonstrate partial liquidation with one collateral', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: {
          initial: exp(2_000_000, 6),
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: exp(1_000_000, 18),
          decimals: 18,
          initialPrice: 50,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.9, 18),
          supplyCap: exp(2e5, 18),
        }
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });
    const { 
      cometWithPartialLiquidation, 
      tokens, 
      priceFeeds, 
      governor, 
      users: [user1, userToLiquidate] 
    } = protocol;
    const { USDC, COMP } = tokens;
    const { COMP: priceFeedCOMP, USDC: priceFeedUSDC, } = priceFeeds;
    console.log('USDC', USDC.address);
    console.log('COMP', COMP.address);
    console.log('baseToken', await cometWithPartialLiquidation.baseToken());
    console.log('assetInfo(0)', await cometWithPartialLiquidation.getAssetInfo(0));
    /// Change price of the assets to 1$ each.
    let currentCOMPData = await priceFeedCOMP.latestRoundData();
    const currentUSDCData = await priceFeedUSDC.latestRoundData();
    await priceFeedCOMP.connect(governor).setRoundData(
      currentCOMPData._roundId,
      exp(1, 8),
      currentCOMPData._startedAt,
      currentCOMPData._updatedAt,
      currentCOMPData._answeredInRound
    );
    await priceFeedUSDC.connect(governor).setRoundData(
      currentUSDCData._roundId,
      exp(1, 8),
      currentUSDCData._startedAt,
      currentUSDCData._updatedAt,
      currentUSDCData._answeredInRound
    );
    
    await USDC.connect(governor).transfer(user1.address, exp(2_000_000, 6));
    await USDC.connect(user1).approve(cometWithPartialLiquidation.address, exp(2_000_000, 6));
    await cometWithPartialLiquidation.connect(user1).supply(USDC.address, exp(2_000_000, 6));
    /// Supply COMP to the liquidated user.
    const compAmount = exp(100_000, 18);  
    await COMP.connect(governor).transfer(userToLiquidate.address, compAmount);
    await COMP.connect(userToLiquidate).approve(cometWithPartialLiquidation.address, compAmount);
    await cometWithPartialLiquidation.connect(userToLiquidate).supply(
      COMP.address, compAmount
    );
    
    let borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, userToLiquidate, 0);
    console.log(`Borrow Capacity: ${borrowCapacityCOMP} USDC`);
    let borrowAmount = borrowCapacityCOMP; // 80$, CF = 80%
    await cometWithPartialLiquidation.connect(userToLiquidate).withdraw(
      USDC.address, borrowAmount); 
    expect(await cometWithPartialLiquidation.borrowBalanceOf(
      userToLiquidate.address)).to.equal(borrowAmount); 

    /// Change the price of the collateral assets to 0.9$ collateral.
    currentCOMPData = await priceFeedCOMP.latestRoundData();
    await priceFeedCOMP.connect(governor).setRoundData(
      currentCOMPData._roundId,
      exp(0.94, 8),
      currentCOMPData._startedAt,
      currentCOMPData._updatedAt,
      currentCOMPData._answeredInRound
    );
    await cometWithPartialLiquidation.accrueAccount(userToLiquidate.address);
    borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, userToLiquidate, 0);
    
    console.log(`Borrow Capacity: ${borrowCapacityCOMP} USDC`);
    console.log('isLiquidatable', await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address));

    expect(await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address)).to.be.true;
    const userBasicBefore = await cometWithPartialLiquidation.userBasic(userToLiquidate.address);
    console.log('User basic before:', userBasicBefore);
    await cometWithPartialLiquidation.connect(user1).absorb(user1.address, [userToLiquidate.address]);
    const userBasicAfter = await cometWithPartialLiquidation.userBasic(userToLiquidate.address);
    console.log('User basic after:', userBasicAfter);
    console.log('borrowBalanceOf', await cometWithPartialLiquidation.borrowBalanceOf(userToLiquidate.address));
    console.log('userCollateral', await cometWithPartialLiquidation.userCollateral(userToLiquidate.address, COMP.address));
    console.log('isLiquidatable', await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address));
    console.log('borrowBalanceOf', await cometWithPartialLiquidation.borrowBalanceOf(userToLiquidate.address));
  });

  it('should demonstrate partial liquidation with two collateral', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: {
          initial: exp(2_000_000, 6),
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: exp(1_000_000, 18),
          decimals: 18,
          initialPrice: 50,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.9, 18),
          supplyCap: exp(2e5, 18),
        },
        USDT: {
          initial: exp(1_000_000, 6),
          decimals: 6,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.9, 18),
          supplyCap: exp(2e5, 6),
        },
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });
    const { 
      cometWithPartialLiquidation, 
      tokens, 
      priceFeeds, 
      governor, 
      users: [user1, userToLiquidate] 
    } = protocol;
    const { USDC, COMP, USDT } = tokens;
    const { COMP: priceFeedCOMP, USDC: priceFeedUSDC, USDT: priceFeedUSDT} = priceFeeds;
    console.log('USDC', USDC.address);
    console.log('COMP', COMP.address);
    console.log('USDT', USDT.address);
    console.log('baseToken', await cometWithPartialLiquidation.baseToken());
    console.log('assetInfo(0)', await cometWithPartialLiquidation.getAssetInfo(0));
    console.log('assetInfo(1)', await cometWithPartialLiquidation.getAssetInfo(1));
    /// Change price of the assets to 1$ each.
    let currentCOMPData = await priceFeedCOMP.latestRoundData();
    let currentUSDTData = await priceFeedUSDT.latestRoundData();
    const currentUSDCData = await priceFeedUSDC.latestRoundData();
    await priceFeedCOMP.connect(governor).setRoundData(
      currentCOMPData._roundId,
      exp(1, 8),
      currentCOMPData._startedAt,
      currentCOMPData._updatedAt,
      currentCOMPData._answeredInRound
    );
    await priceFeedUSDC.connect(governor).setRoundData(
      currentUSDCData._roundId,
      exp(1, 8),
      currentUSDCData._startedAt,
      currentUSDCData._updatedAt,
      currentUSDCData._answeredInRound
    );
    await priceFeedUSDT.connect(governor).setRoundData(
      currentUSDTData._roundId,
      exp(1, 8),
      currentUSDTData._startedAt,
      currentUSDTData._updatedAt,
      currentUSDTData._answeredInRound
    );
    
    await USDC.connect(governor).transfer(user1.address, exp(2_000_000, 6));
    await USDC.connect(user1).approve(cometWithPartialLiquidation.address, exp(2_000_000, 6));
    await cometWithPartialLiquidation.connect(user1).supply(USDC.address, exp(2_000_000, 6));
    /// Supply COMP to the liquidated user.
    const compAmount = exp(20_000, 18);  
    await COMP.connect(governor).transfer(userToLiquidate.address, compAmount);
    await COMP.connect(userToLiquidate).approve(cometWithPartialLiquidation.address, compAmount);
    await cometWithPartialLiquidation.connect(userToLiquidate).supply(
      COMP.address, compAmount);   
    let borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, userToLiquidate, 0);
    console.log(`Borrow Capacity: ${borrowCapacityCOMP} for COMP`);
    let borrowAmountCOMP = borrowCapacityCOMP; // 80$, CF = 80%
    /// Supply USDT to the liquidated user.
    const usdtAmount = exp(100_000, 6);
    await USDT.connect(governor).transfer(userToLiquidate.address, usdtAmount);
    await USDT.connect(userToLiquidate).approve(cometWithPartialLiquidation.address, usdtAmount);
    await cometWithPartialLiquidation.connect(userToLiquidate).supply(USDT.address, usdtAmount);
    let borrowCapacityUSDT = await borrowCapacityForAsset(cometWithPartialLiquidation, userToLiquidate, 1);
    console.log(`Borrow Capacity: ${borrowCapacityUSDT} for USDT`);
    let borrowAmountUSDT = borrowCapacityUSDT; // 90$, CF = 90%
    let totalBorrowAmount = borrowAmountCOMP.add(borrowAmountUSDT);
    /// Borrow USDC againt USDT.
    await cometWithPartialLiquidation.connect(userToLiquidate).withdraw(
      USDC.address, totalBorrowAmount); 
    expect(await cometWithPartialLiquidation.borrowBalanceOf(
      userToLiquidate.address)).to.equal(totalBorrowAmount); 
    
    /// Change the price of the collateral assets to 0.9$ collateral.
    currentCOMPData = await priceFeedCOMP.latestRoundData();
    await priceFeedCOMP.connect(governor).setRoundData(
      currentCOMPData._roundId,
      exp(0.62, 8),
      currentCOMPData._startedAt,
      currentCOMPData._updatedAt,
      currentCOMPData._answeredInRound
    );
    await cometWithPartialLiquidation.accrueAccount(userToLiquidate.address);
    borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, userToLiquidate, 0);
    borrowCapacityUSDT = await borrowCapacityForAsset(cometWithPartialLiquidation, userToLiquidate, 1);
    console.log('borrowBalanceOf', await cometWithPartialLiquidation.borrowBalanceOf(userToLiquidate.address));
    console.log(`Borrow Capacity: ${borrowCapacityCOMP} for COMP`);
    console.log(`Borrow Capacity: ${borrowCapacityUSDT} for USDT`);
    console.log('isLiquidatable', await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address));

    expect(await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address)).to.be.true;
    const userBasicBefore = await cometWithPartialLiquidation.userBasic(userToLiquidate.address);
    console.log('User basic before:', userBasicBefore);
    await cometWithPartialLiquidation.connect(user1).absorb(user1.address, [userToLiquidate.address]);
    const userBasicAfter = await cometWithPartialLiquidation.userBasic(userToLiquidate.address);
    console.log('User basic after:', userBasicAfter);
    console.log('borrowBalanceOf', await cometWithPartialLiquidation.borrowBalanceOf(userToLiquidate.address));
    console.log('userCollateral 0', await cometWithPartialLiquidation.userCollateral(userToLiquidate.address, COMP.address));
    console.log('userCollateral 1', await cometWithPartialLiquidation.userCollateral(userToLiquidate.address, USDT.address));
    console.log('isLiquidatable', await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address));
    console.log('borrowBalanceOf', await cometWithPartialLiquidation.borrowBalanceOf(userToLiquidate.address));
  });

  it('should demonstrate partial liquidation', async function () {
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
    const { COMP: priceFeedCOMP, USDT: priceFeedUSDT } = priceFeeds;

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
      await ethers.provider.send('evm_increaseTime', [1 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
      console.log('iterations', iterations);
      iterations++;
    }
    expect(await cometWithPartialLiquidation.isLiquidatable(userToLiquidate.address)).to.be.true;
    const userBasicBefore = await cometWithPartialLiquidation.userBasic(userToLiquidate.address);
    console.log('User basic before:', userBasicBefore);
    await cometWithPartialLiquidation.connect(user1).absorb(user1.address, [userToLiquidate.address]);
    const userBasicAfter = await cometWithPartialLiquidation.userBasic(userToLiquidate.address);
    console.log('User basic after:', userBasicAfter);

  });

  it('should return false when user has no debt', async function () {
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
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with collateral but no debt
    await COMP.connect(governor).transfer(user1.address, exp(100, 18));
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(100, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(100, 18));

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
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with USDC deposit (positive principal)
    await USDC.connect(governor).transfer(user1.address, exp(1000, 6));
    await USDC.connect(user1).approve(cometWithPartialLiquidation.address, exp(1000, 6));
    await cometWithPartialLiquidation.connect(user1).supply(USDC.address, exp(1000, 6));

    // Add some collateral
    await COMP.connect(governor).transfer(user1.address, exp(100, 18));
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(100, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(100, 18));

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
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with sufficient collateral
    await COMP.connect(governor).transfer(user1.address, exp(200, 18)); // 200 COMP = $10,000
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(200, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(200, 18));

    // Calculate borrow capacity and take some debt
    const borrowCapacity = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 0);
    const borrowAmount = borrowCapacity.div(2); // Take only half of capacity
    await cometWithPartialLiquidation.connect(user1).withdraw(USDC.address, borrowAmount);

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

  it('should return true when user has insufficient collateral for debt', async function () {
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
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;
    const { COMP: priceFeedCOMP } = priceFeeds;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with insufficient collateral
    await COMP.connect(governor).transfer(user1.address, exp(50, 18)); // 50 COMP = $2,500
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(50, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(50, 18));

    // Take maximum borrow capacity
    const borrowCapacity = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 0);
    await cometWithPartialLiquidation.connect(user1).withdraw(USDC.address, borrowCapacity);

    // Create liquidation conditions by dropping COMP price
    let iterations = 0;
    while(!(await cometWithPartialLiquidation.isLiquidatable(user1.address)) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(95).div(100), // Decrease price by 5%
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]); // 1 week
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }

    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    expect(isLiquidatable).to.be.true;

    // Perform liquidation
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const initialCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();

    // Verify liquidation occurred
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    expect(finalCollateral.balance.toBigInt()).to.be.lt(initialCollateral.balance.toBigInt());
    expect(finalIsLiquidatable).to.be.false; // Should be fully liquidated
  });

  it('should successfully absorb user with single collateral', async function () {
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
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;
    const { COMP: priceFeedCOMP } = priceFeeds;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with collateral
    await COMP.connect(governor).transfer(user1.address, exp(100, 18)); // 100 COMP = $5,000
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(100, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(100, 18));

    // Take maximum borrow capacity
    const borrowCapacity = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 0);
    await cometWithPartialLiquidation.connect(user1).withdraw(USDC.address, borrowCapacity);

    // Create liquidation conditions by dropping COMP price
    let iterations = 0;
    while(!(await cometWithPartialLiquidation.isLiquidatable(user1.address)) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(90).div(100), // Decrease price by 10%
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]); // 1 week
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }

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
        WETH: {
          initial: exp(1e6, 18),
          decimals: 18,
          initialPrice: 2000,
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
          liquidationFactor: exp(0.65, 18),
          supplyCap: exp(1e4, 18),
        },
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP, WETH } = tokens;
    const { COMP: priceFeedCOMP, WETH: priceFeedWETH } = priceFeeds;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with multiple collaterals
    await COMP.connect(governor).transfer(user1.address, exp(50, 18)); // 50 COMP = $2,500
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(50, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(50, 18));

    await WETH.connect(governor).transfer(user1.address, exp(1, 18)); // 1 WETH = $2,000
    await WETH.connect(user1).approve(cometWithPartialLiquidation.address, exp(1, 18));
    await cometWithPartialLiquidation.connect(user1).supply(WETH.address, exp(1, 18));

    // Calculate total borrow capacity and take debt
    const borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 0);
    const borrowCapacityWETH = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 1);
    const totalBorrowCapacity = borrowCapacityCOMP.add(borrowCapacityWETH);
    await cometWithPartialLiquidation.connect(user1).withdraw(USDC.address, totalBorrowCapacity);

    // Create liquidation conditions by dropping prices
    let iterations = 0;
    while(!(await cometWithPartialLiquidation.isLiquidatable(user1.address)) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(90).div(100), // Decrease COMP price by 10%
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      const currentWETHData = await priceFeedWETH.latestRoundData();
      await priceFeedWETH.connect(governor).setRoundData(
        currentWETHData._roundId,
        currentWETHData._answer.mul(90).div(100), // Decrease WETH price by 10%
        currentWETHData._startedAt,
        currentWETHData._updatedAt,
        currentWETHData._answeredInRound
      );

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]); // 1 week
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }

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
        WETH: {
          initial: exp(1e6, 18),
          decimals: 18,
          initialPrice: 2000,
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
          liquidationFactor: exp(0.65, 18),
          supplyCap: exp(1e4, 18),
        },
        WBTC: {
          initial: exp(1e6, 8),
          decimals: 8,
          initialPrice: 50000,
          borrowCF: exp(0.7, 18),
          liquidateCF: exp(0.75, 18),
          liquidationFactor: exp(0.6, 18),
          supplyCap: exp(100, 8),
        },
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP, WETH, WBTC } = tokens;
    const { COMP: priceFeedCOMP, WETH: priceFeedWETH, WBTC: priceFeedWBTC } = priceFeeds;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with small amounts of first two collaterals and sufficient last collateral
    await COMP.connect(governor).transfer(user1.address, exp(20, 18)); // 20 COMP = $1,000
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(20, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(20, 18));

    await WETH.connect(governor).transfer(user1.address, exp(0.2, 18)); // 0.2 WETH = $400
    await WETH.connect(user1).approve(cometWithPartialLiquidation.address, exp(0.2, 18));
    await cometWithPartialLiquidation.connect(user1).supply(WETH.address, exp(0.2, 18));

    await WBTC.connect(governor).transfer(user1.address, exp(0.02, 8)); // 0.02 WBTC = $1,000
    await WBTC.connect(user1).approve(cometWithPartialLiquidation.address, exp(0.02, 8));
    await cometWithPartialLiquidation.connect(user1).supply(WBTC.address, exp(0.02, 8));

    // Calculate total borrow capacity and take debt
    const borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 0);
    const borrowCapacityWETH = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 1);
    const borrowCapacityWBTC = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 2);
    const totalBorrowCapacity = borrowCapacityCOMP.add(borrowCapacityWETH).add(borrowCapacityWBTC);
    await cometWithPartialLiquidation.connect(user1).withdraw(USDC.address, totalBorrowCapacity);

    // Create liquidation conditions by dropping prices of first two collaterals heavily
    let iterations = 0;
    while(!(await cometWithPartialLiquidation.isLiquidatable(user1.address)) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(70).div(100), // Decrease COMP price by 30%
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      const currentWETHData = await priceFeedWETH.latestRoundData();
      await priceFeedWETH.connect(governor).setRoundData(
        currentWETHData._roundId,
        currentWETHData._answer.mul(70).div(100), // Decrease WETH price by 30%
        currentWETHData._startedAt,
        currentWETHData._updatedAt,
        currentWETHData._answeredInRound
      );

      // Keep WBTC price stable or slightly decrease
      const currentWBTCData = await priceFeedWBTC.latestRoundData();
      await priceFeedWBTC.connect(governor).setRoundData(
        currentWBTCData._roundId,
        currentWBTCData._answer.mul(95).div(100), // Decrease WBTC price by 5%
        currentWBTCData._startedAt,
        currentWBTCData._updatedAt,
        currentWBTCData._answeredInRound
      );

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]); // 1 week
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }

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
        WETH: {
          initial: exp(1e6, 18),
          decimals: 18,
          initialPrice: 2000,
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
          liquidationFactor: exp(0.65, 18),
          supplyCap: exp(1e4, 18),
        },
        WBTC: {
          initial: exp(1e6, 8),
          decimals: 8,
          initialPrice: 50000,
          borrowCF: exp(0.7, 18),
          liquidateCF: exp(0.75, 18),
          liquidationFactor: exp(0.6, 18),
          supplyCap: exp(100, 8),
        },
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP, WETH, WBTC } = tokens;
    const { COMP: priceFeedCOMP, WETH: priceFeedWETH, WBTC: priceFeedWBTC } = priceFeeds;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with small amounts of all collaterals (all insufficient)
    await COMP.connect(governor).transfer(user1.address, exp(10, 18)); // 10 COMP = $500
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(10, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(10, 18));

    await WETH.connect(governor).transfer(user1.address, exp(0.1, 18)); // 0.1 WETH = $200
    await WETH.connect(user1).approve(cometWithPartialLiquidation.address, exp(0.1, 18));
    await cometWithPartialLiquidation.connect(user1).supply(WETH.address, exp(0.1, 18));

    await WBTC.connect(governor).transfer(user1.address, exp(0.001, 8)); // 0.001 WBTC = $50
    await WBTC.connect(user1).approve(cometWithPartialLiquidation.address, exp(0.001, 8));
    await cometWithPartialLiquidation.connect(user1).supply(WBTC.address, exp(0.001, 8));

    // Calculate total borrow capacity and take debt
    const borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 0);
    const borrowCapacityWETH = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 1);
    const borrowCapacityWBTC = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 2);
    const totalBorrowCapacity = borrowCapacityCOMP.add(borrowCapacityWETH).add(borrowCapacityWBTC);
    await cometWithPartialLiquidation.connect(user1).withdraw(USDC.address, totalBorrowCapacity);

    // Create liquidation conditions by dropping all prices heavily
    let iterations = 0;
    while(!(await cometWithPartialLiquidation.isLiquidatable(user1.address)) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(60).div(100), // Decrease COMP price by 40%
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      const currentWETHData = await priceFeedWETH.latestRoundData();
      await priceFeedWETH.connect(governor).setRoundData(
        currentWETHData._roundId,
        currentWETHData._answer.mul(60).div(100), // Decrease WETH price by 40%
        currentWETHData._startedAt,
        currentWETHData._updatedAt,
        currentWETHData._answeredInRound
      );

      const currentWBTCData = await priceFeedWBTC.latestRoundData();
      await priceFeedWBTC.connect(governor).setRoundData(
        currentWBTCData._roundId,
        currentWBTCData._answer.mul(60).div(100), // Decrease WBTC price by 40%
        currentWBTCData._startedAt,
        currentWBTCData._updatedAt,
        currentWBTCData._answeredInRound
      );

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]); // 1 week
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }

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
        WETH: {
          initial: exp(1e6, 18),
          decimals: 18,
          initialPrice: 2000,
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
          liquidationFactor: exp(0.65, 18),
          supplyCap: exp(1e4, 18),
        },
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP, WETH } = tokens;
    const { COMP: priceFeedCOMP, WETH: priceFeedWETH } = priceFeeds;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with insufficient collaterals
    await COMP.connect(governor).transfer(user1.address, exp(15, 18)); // 15 COMP = $750
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(15, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(15, 18));

    await WETH.connect(governor).transfer(user1.address, exp(0.1, 18)); // 0.1 WETH = $200
    await WETH.connect(user1).approve(cometWithPartialLiquidation.address, exp(0.1, 18));
    await cometWithPartialLiquidation.connect(user1).supply(WETH.address, exp(0.1, 18));

    // Calculate total borrow capacity and take debt
    const borrowCapacityCOMP = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 0);
    const borrowCapacityWETH = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 1);
    const totalBorrowCapacity = borrowCapacityCOMP.add(borrowCapacityWETH);
    await cometWithPartialLiquidation.connect(user1).withdraw(USDC.address, totalBorrowCapacity);

    // Create liquidation conditions by dropping prices
    let iterations = 0;
    while(!(await cometWithPartialLiquidation.isLiquidatable(user1.address)) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(80).div(100), // Decrease COMP price by 20%
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      const currentWETHData = await priceFeedWETH.latestRoundData();
      await priceFeedWETH.connect(governor).setRoundData(
        currentWETHData._roundId,
        currentWETHData._answer.mul(80).div(100), // Decrease WETH price by 20%
        currentWETHData._startedAt,
        currentWETHData._updatedAt,
        currentWETHData._answeredInRound
      );

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]); // 1 week
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }

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
      },
      baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
    });

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;
    const { COMP: priceFeedCOMP } = priceFeeds;

    // Setup liquidator with USDC
    await USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
    await USDC.connect(liquidator).approve(cometWithPartialLiquidation.address, exp(10000, 6));
    await cometWithPartialLiquidation.connect(liquidator).supply(USDC.address, exp(10000, 6));

    // Setup user with exact collateral amount for full liquidation
    await COMP.connect(governor).transfer(user1.address, exp(20, 18)); // 20 COMP = $1,000
    await COMP.connect(user1).approve(cometWithPartialLiquidation.address, exp(20, 18));
    await cometWithPartialLiquidation.connect(user1).supply(COMP.address, exp(20, 18));

    // Take maximum borrow capacity
    const borrowCapacity = await borrowCapacityForAsset(cometWithPartialLiquidation, user1, 0);
    await cometWithPartialLiquidation.connect(user1).withdraw(USDC.address, borrowCapacity);

    // Create liquidation conditions by dropping COMP price significantly
    let iterations = 0;
    while(!(await cometWithPartialLiquidation.isLiquidatable(user1.address)) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(50).div(100), // Decrease COMP price by 50%
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]); // 1 week
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }

    // const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    // const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
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

  it('should correctly calculate newBalance and newPrincipal in absorbInternal', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: {
          initial: exp(10_000_000, 6),
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: exp(1_000_000, 18),
          decimals: 18,
          initialPrice: 1,                  // $1 per COMP
          borrowCF: exp(0.8, 18),           // 80%
          liquidateCF: exp(0.85, 18),       // 85%
          liquidationFactor: exp(0.9, 18),  // 90% (10% penalty)
          supplyCap: exp(1e6, 18),
        }
      },
      baseTrackingBorrowSpeed: 0, // Disable to avoid interest complications
    });

    const {
      cometWithPartialLiquidation,
      tokens,
      priceFeeds,
      governor,
      users: [supplier, borrower, liquidator]
    } = protocol;
    const { USDC, COMP } = tokens;
    const { COMP: priceFeedCOMP } = priceFeeds;

    // Fund supplier
    await USDC.connect(governor).transfer(supplier.address, exp(1_000_000, 6));
    await USDC.connect(supplier).approve(cometWithPartialLiquidation.address, exp(1_000_000, 6));
    await cometWithPartialLiquidation.connect(supplier).supply(USDC.address, exp(1_000_000, 6));

    // Borrower: Supply 100 COMP ($100 value) and borrow 80 USDC
    const compAmount = exp(100, 18);
    await COMP.connect(governor).transfer(borrower.address, compAmount);
    await COMP.connect(borrower).approve(cometWithPartialLiquidation.address, compAmount);
    await cometWithPartialLiquidation.connect(borrower).supply(COMP.address, compAmount);

    const borrowAmount = exp(80, 6); // Borrow 80 USDC (max capacity with 80% CF)
    await cometWithPartialLiquidation.connect(borrower).withdraw(USDC.address, borrowAmount);

    // Drop COMP price to $0.93 to make position liquidatable
    const currentData = await priceFeedCOMP.latestRoundData();
    await priceFeedCOMP.connect(governor).setRoundData(
      currentData._roundId,
      exp(0.93, 8),
      currentData._startedAt,
      currentData._updatedAt,
      currentData._answeredInRound
    );

    await cometWithPartialLiquidation.accrueAccount(borrower.address);
    expect(await cometWithPartialLiquidation.isLiquidatable(borrower.address)).to.be.true;

    // Capture pre-liquidation state
    const userBasicBefore = await cometWithPartialLiquidation.userBasic(borrower.address);
    const oldPrincipal = userBasicBefore.principal;

    // oldBalance = presentValue(oldPrincipal)
    // Since no time has passed and baseTrackingBorrowSpeed = 0, indices should be initial values
    const totalsBasic = await cometWithPartialLiquidation.totalsBasic();
    const baseBorrowIndex = totalsBasic.baseBorrowIndex.toBigInt();
    const baseSupplyIndex = totalsBasic.baseSupplyIndex.toBigInt();
    const baseScale = (await cometWithPartialLiquidation.baseScale()).toBigInt();
    const factorScale = (await cometWithPartialLiquidation.factorScale()).toBigInt();
    const BASE_INDEX_SCALE = 1000000000000000n; // 1e15

    // Calculate oldBalance: presentValue(oldPrincipal)
    // For negative principal (debt): -presentValueBorrow(baseBorrowIndex, abs(oldPrincipal))
    const oldPrincipalAbs = -BigInt(oldPrincipal.toString());
    const oldBalanceCalculated = -(oldPrincipalAbs * baseBorrowIndex / BASE_INDEX_SCALE);
    console.log('oldPrincipal:', oldPrincipal.toString());
    console.log('oldBalance (calculated):', oldBalanceCalculated.toString());

    // Perform liquidation and capture events
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [borrower.address]);
    const receipt = await absorbTx.wait();

    // Extract AbsorbCollateral events to get seized collateral details
    const absorbCollateralEvents = receipt.logs
      .map(log => {
        try {
          return cometWithPartialLiquidation.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(parsed => parsed && parsed.name === 'AbsorbCollateral');

    expect(absorbCollateralEvents.length).to.be.gt(0, 'Should have AbsorbCollateral events');

    // Calculate deltaValue from seized collateral
    // deltaValue = sum of (seizedValue from each collateral)
    // seizedValue = collateralValue * liquidationFactor
    let deltaValueManual = 0n;
    const compPrice = BigInt(exp(0.93, 8)); // $0.93 in 8 decimals
    const compScale = BigInt(exp(1, 18));   // COMP has 18 decimals
    const liquidationFactor = BigInt(exp(0.9, 18)); // 90%

    for (const event of absorbCollateralEvents) {
      if (!event || !event.args) {
        console.log('Warning: Event or args is null, skipping');
        continue;
      }

      // event.args is: [absorber, borrower, asset, seizeAmount, value]
      const asset = event.args[2]; // asset address
      const seizeAmount = BigInt(event.args[3]); // seizeAmount

      if (asset === COMP.address) {
        // collateralValue = mulPrice(seizeAmount, price, scale)
        // mulPrice(n, price, fromScale) = n * price / fromScale
        const collateralValue = seizeAmount * compPrice / compScale;

        // seizedValue = mulFactor(collateralValue, liquidationFactor)
        // mulFactor(n, factor) = n * factor / FACTOR_SCALE
        const seizedValue = collateralValue * liquidationFactor / factorScale;

        deltaValueManual += seizedValue;
        console.log('Seized COMP amount:', seizeAmount.toString());
        console.log('Collateral value (price scale):', collateralValue.toString());
        console.log('Seized value (price scale):', seizedValue.toString());
      }
    }

    console.log('deltaValue (manual):', deltaValueManual.toString());

    // Calculate expected new balance
    // newBalance = oldBalance + signed256(divPrice(deltaValue, basePrice, baseScale))
    // divPrice(n, price, toScale) = n * toScale / price

    const basePrice = BigInt(exp(1, 8)); // USDC price = $1.00 in 8 decimals
    const deltaBalanceManual = deltaValueManual * baseScale / basePrice;
    console.log('deltaBalance (manual):', deltaBalanceManual.toString());

    const newBalanceExpected = oldBalanceCalculated + deltaBalanceManual;
    console.log('newBalance (expected):', newBalanceExpected.toString());

    // Calculated expected new principal
    // newPrincipal = principalValue(newBalance)
    let newPrincipalExpected: bigint;

    if (newBalanceExpected >= 0n) {
      // Positive balance means supply
      // principalValueSupply(baseSupplyIndex, presentValue) = (presentValue * BASE_INDEX_SCALE) / baseSupplyIndex
      newPrincipalExpected = (newBalanceExpected * BASE_INDEX_SCALE) / baseSupplyIndex;
      console.log('newBalance is positive, user becomes supplier');
    } else {
      // Negative balance means debt
      // principalValueBorrow(baseBorrowIndex, presentValue) = (presentValue * BASE_INDEX_SCALE + baseBorrowIndex - 1) / baseBorrowIndex
      const absPresentValue = -newBalanceExpected;
      newPrincipalExpected = -((absPresentValue * BASE_INDEX_SCALE + baseBorrowIndex - 1n) / baseBorrowIndex);
      console.log('newBalance is negative, user still has debt');
    }

    console.log('newPrincipal (expected):', newPrincipalExpected.toString());

    // Get actual values from contract
    const userBasicAfter = await cometWithPartialLiquidation.userBasic(borrower.address);
    const newPrincipalActual = userBasicAfter.principal.toBigInt();

    // Calculate actual newBalance from newPrincipal
    let newBalanceActual: bigint;
    if (newPrincipalActual >= 0n) {
      newBalanceActual = newPrincipalActual * baseSupplyIndex / BASE_INDEX_SCALE;
    } else {
      const absPrincipal = -newPrincipalActual;
      newBalanceActual = -(absPrincipal * baseBorrowIndex / BASE_INDEX_SCALE);
    }

    console.log('newPrincipal (actual):', newPrincipalActual.toString());
    console.log('newBalance (actual):', newBalanceActual.toString());

    // Validate calculations
    // The contract's calculations should match test calculations

    // Allow small rounding difference (due to integer division)
    const balanceDiff = newBalanceActual > newBalanceExpected
      ? newBalanceActual - newBalanceExpected
      : newBalanceExpected - newBalanceActual;

    const principalDiff = newPrincipalActual > newPrincipalExpected
      ? newPrincipalActual - newPrincipalExpected
      : newPrincipalExpected - newPrincipalActual;

    console.log('Balance difference:', balanceDiff.toString());
    console.log('Principal difference:', principalDiff.toString());

    // Assertions: values should match exactly or within 1 unit due to rounding
    expect(balanceDiff).to.be.lte(1n);
    expect(principalDiff).to.be.lte(1n);

    // Additional validation: user should not be liquidatable after partial liquidation
    const isLiquidatableAfter = await cometWithPartialLiquidation.isLiquidatable(borrower.address);
    expect(isLiquidatableAfter).to.be.false;
  });
});
