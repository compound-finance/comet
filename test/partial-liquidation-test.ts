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

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;
    const { COMP: priceFeedCOMP } = priceFeeds;

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

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;
    const { COMP: priceFeedCOMP } = priceFeeds;

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

    const { cometWithPartialLiquidation, tokens, priceFeeds, governor, users: [user1, liquidator] } = protocol;
    const { USDC, COMP } = tokens;
    const { COMP: priceFeedCOMP } = priceFeeds;

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
