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

async function setPrice(priceFeed: any, governor: SignerWithAddress, price: number) {
  const rd = await priceFeed.latestRoundData();
  await priceFeed.connect(governor).setRoundData(rd[0], exp(price, 8), rd[2], rd[3], rd[4]);
}

async function dropPriceByPercent(priceFeed: any, governor: SignerWithAddress, percent: number) {
  const rd = await priceFeed.latestRoundData();
  await priceFeed.connect(governor).setRoundData(
    rd[0], rd[1].mul(100 - percent).div(100), rd[2], rd[3], rd[4]
  );
}

async function makeLiquidatable(
  comet: CometInterface,
  user: SignerWithAddress,
  priceDrops: Array<{ feed: any; governor: SignerWithAddress; percent: number }>
) {
  let iters = 0;
  while (!(await comet.isLiquidatable(user.address)) && iters < 50) {
    for (const { feed, governor, percent } of priceDrops) {
      await dropPriceByPercent(feed, governor, percent);
    }
    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);
    iters++;
  }
}

describe('CometWithExtendedAssetList - Partial Liquidation', function() {

  // ── Demonstration scenarios (demos 1+2 share protocol; demo 3 standalone) ──

  describe('demonstration: one and two collaterals', function() {
    let comet: CometInterface;
    let tokens: any, priceFeeds: any, governor: SignerWithAddress;
    let users: SignerWithAddress[];
    let snapshotId: string;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(2_000_000, 6), decimals: 6, initialPrice: 1 },
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
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor, users } = protocol);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('should demonstrate partial liquidation with one collateral', async function () {
      const [user1, userToLiquidate] = users;
      const { USDC, COMP } = tokens;
      const { COMP: priceFeedCOMP, USDC: priceFeedUSDC } = priceFeeds;

      console.log('USDC', USDC.address);
      console.log('COMP', COMP.address);
      console.log('baseToken', await comet.baseToken());
      console.log('assetInfo(0)', await comet.getAssetInfo(0));

      await setPrice(priceFeedCOMP, governor, 1);
      await setPrice(priceFeedUSDC, governor, 1);

      await USDC.connect(governor).transfer(user1.address, exp(2_000_000, 6));
      await USDC.connect(user1).approve(comet.address, exp(2_000_000, 6));
      await comet.connect(user1).supply(USDC.address, exp(2_000_000, 6));

      const compAmount = exp(100_000, 18);
      await COMP.connect(governor).transfer(userToLiquidate.address, compAmount);
      await COMP.connect(userToLiquidate).approve(comet.address, compAmount);
      await comet.connect(userToLiquidate).supply(COMP.address, compAmount);

      let borrowCapacityCOMP = await borrowCapacityForAsset(comet, userToLiquidate, 0);
      console.log(`Borrow Capacity: ${borrowCapacityCOMP} USDC`);
      await comet.connect(userToLiquidate).withdraw(USDC.address, borrowCapacityCOMP);
      expect(await comet.borrowBalanceOf(userToLiquidate.address)).to.equal(borrowCapacityCOMP);

      await setPrice(priceFeedCOMP, governor, 0.94);
      await comet.accrueAccount(userToLiquidate.address);
      borrowCapacityCOMP = await borrowCapacityForAsset(comet, userToLiquidate, 0);
      console.log(`Borrow Capacity: ${borrowCapacityCOMP} USDC`);
      console.log('isLiquidatable', await comet.isLiquidatable(userToLiquidate.address));

      expect(await comet.isLiquidatable(userToLiquidate.address)).to.be.true;
      const userBasicBefore = await comet.userBasic(userToLiquidate.address);
      console.log('User basic before:', userBasicBefore);
      await comet.connect(user1).absorb(user1.address, [userToLiquidate.address]);
      const userBasicAfter = await comet.userBasic(userToLiquidate.address);
      console.log('User basic after:', userBasicAfter);
      console.log('borrowBalanceOf', await comet.borrowBalanceOf(userToLiquidate.address));
      console.log('userCollateral', await comet.userCollateral(userToLiquidate.address, COMP.address));
      console.log('isLiquidatable', await comet.isLiquidatable(userToLiquidate.address));
    });

    it('should demonstrate partial liquidation with two collateral', async function () {
      const [user1, userToLiquidate] = users;
      const { USDC, COMP, USDT } = tokens;
      const { COMP: priceFeedCOMP, USDC: priceFeedUSDC, USDT: priceFeedUSDT } = priceFeeds;

      console.log('USDC', USDC.address);
      console.log('COMP', COMP.address);
      console.log('USDT', USDT.address);
      console.log('baseToken', await comet.baseToken());
      console.log('assetInfo(0)', await comet.getAssetInfo(0));
      console.log('assetInfo(1)', await comet.getAssetInfo(1));

      await setPrice(priceFeedCOMP, governor, 1);
      await setPrice(priceFeedUSDC, governor, 1);
      await setPrice(priceFeedUSDT, governor, 1);

      await USDC.connect(governor).transfer(user1.address, exp(2_000_000, 6));
      await USDC.connect(user1).approve(comet.address, exp(2_000_000, 6));
      await comet.connect(user1).supply(USDC.address, exp(2_000_000, 6));

      const compAmount = exp(20_000, 18);
      await COMP.connect(governor).transfer(userToLiquidate.address, compAmount);
      await COMP.connect(userToLiquidate).approve(comet.address, compAmount);
      await comet.connect(userToLiquidate).supply(COMP.address, compAmount);
      let borrowCapacityCOMP = await borrowCapacityForAsset(comet, userToLiquidate, 0);
      console.log(`Borrow Capacity: ${borrowCapacityCOMP} for COMP`);

      const usdtAmount = exp(100_000, 6);
      await USDT.connect(governor).transfer(userToLiquidate.address, usdtAmount);
      await USDT.connect(userToLiquidate).approve(comet.address, usdtAmount);
      await comet.connect(userToLiquidate).supply(USDT.address, usdtAmount);
      let borrowCapacityUSDT = await borrowCapacityForAsset(comet, userToLiquidate, 1);
      console.log(`Borrow Capacity: ${borrowCapacityUSDT} for USDT`);

      const totalBorrowAmount = borrowCapacityCOMP.add(borrowCapacityUSDT);
      await comet.connect(userToLiquidate).withdraw(USDC.address, totalBorrowAmount);
      expect(await comet.borrowBalanceOf(userToLiquidate.address)).to.equal(totalBorrowAmount);

      await setPrice(priceFeedCOMP, governor, 0.62);
      await comet.accrueAccount(userToLiquidate.address);
      borrowCapacityCOMP = await borrowCapacityForAsset(comet, userToLiquidate, 0);
      borrowCapacityUSDT = await borrowCapacityForAsset(comet, userToLiquidate, 1);
      console.log('borrowBalanceOf', await comet.borrowBalanceOf(userToLiquidate.address));
      console.log(`Borrow Capacity: ${borrowCapacityCOMP} for COMP`);
      console.log(`Borrow Capacity: ${borrowCapacityUSDT} for USDT`);
      console.log('isLiquidatable', await comet.isLiquidatable(userToLiquidate.address));

      expect(await comet.isLiquidatable(userToLiquidate.address)).to.be.true;
      const userBasicBefore = await comet.userBasic(userToLiquidate.address);
      console.log('User basic before:', userBasicBefore);
      await comet.connect(user1).absorb(user1.address, [userToLiquidate.address]);
      const userBasicAfter = await comet.userBasic(userToLiquidate.address);
      console.log('User basic after:', userBasicAfter);
      console.log('borrowBalanceOf', await comet.borrowBalanceOf(userToLiquidate.address));
      console.log('userCollateral 0', await comet.userCollateral(userToLiquidate.address, COMP.address));
      console.log('userCollateral 1', await comet.userCollateral(userToLiquidate.address, USDT.address));
      console.log('isLiquidatable', await comet.isLiquidatable(userToLiquidate.address));
    });
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
      await dropPriceByPercent(priceFeedCOMP, governor, 5);
      await dropPriceByPercent(priceFeedUSDT, governor, 2);
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

  // ── Single collateral (COMP, price=50, LF=0.7) ───────────────────────────

  describe('single collateral scenarios', function() {
    let comet: CometInterface;
    let tokens: any, priceFeeds: any, governor: SignerWithAddress;
    let user1: SignerWithAddress, liquidator: SignerWithAddress;
    let snapshotId: string;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(1e6, 6), decimals: 6, initialPrice: 1 },
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
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      [user1, liquidator] = protocol.users;

      await tokens.USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
      await tokens.USDC.connect(liquidator).approve(comet.address, exp(10000, 6));
      await comet.connect(liquidator).supply(tokens.USDC.address, exp(10000, 6));

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('should return false when user has no debt', async function () {
      const { COMP } = tokens;

      await COMP.connect(governor).transfer(user1.address, exp(100, 18));
      await COMP.connect(user1).approve(comet.address, exp(100, 18));
      await comet.connect(user1).supply(COMP.address, exp(100, 18));

      expect(await comet.isLiquidatable(user1.address)).to.be.false;

      try {
        await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();
        expect.fail('Absorb should have failed because user is not liquidatable');
      } catch (error) {
        expect(error.message).to.include('NotLiquidatable');
      }
    });

    it('should return false when user has deposit', async function () {
      const { USDC, COMP } = tokens;

      await USDC.connect(governor).transfer(user1.address, exp(1000, 6));
      await USDC.connect(user1).approve(comet.address, exp(1000, 6));
      await comet.connect(user1).supply(USDC.address, exp(1000, 6));

      await COMP.connect(governor).transfer(user1.address, exp(100, 18));
      await COMP.connect(user1).approve(comet.address, exp(100, 18));
      await comet.connect(user1).supply(COMP.address, exp(100, 18));

      expect(await comet.isLiquidatable(user1.address)).to.be.false;

      try {
        await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();
        expect.fail('Absorb should have failed because user is not liquidatable');
      } catch (error) {
        expect(error.message).to.include('NotLiquidatable');
      }
    });

    it('should return false when user has sufficient collateral for debt', async function () {
      const { COMP } = tokens;

      await COMP.connect(governor).transfer(user1.address, exp(200, 18));
      await COMP.connect(user1).approve(comet.address, exp(200, 18));
      await comet.connect(user1).supply(COMP.address, exp(200, 18));

      const borrowCapacity = await borrowCapacityForAsset(comet, user1, 0);
      await comet.connect(user1).withdraw(tokens.USDC.address, borrowCapacity.div(2));

      expect(await comet.isLiquidatable(user1.address)).to.be.false;

      try {
        await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();
        expect.fail('Absorb should have failed because user is not liquidatable');
      } catch (error) {
        expect(error.message).to.include('NotLiquidatable');
      }
    });

    it('should return true when user has insufficient collateral for debt', async function () {
      const { COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      await COMP.connect(governor).transfer(user1.address, exp(50, 18));
      await COMP.connect(user1).approve(comet.address, exp(50, 18));
      await comet.connect(user1).supply(COMP.address, exp(50, 18));

      const borrowCapacity = await borrowCapacityForAsset(comet, user1, 0);
      await comet.connect(user1).withdraw(tokens.USDC.address, borrowCapacity);

      await makeLiquidatable(comet, user1, [{ feed: priceFeedCOMP, governor, percent: 5 }]);

      expect(await comet.isLiquidatable(user1.address)).to.be.true;

      const initialDebt = await comet.borrowBalanceOf(user1.address);
      const initialCollateral = await comet.userCollateral(user1.address, COMP.address);

      await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();

      const finalDebt = await comet.borrowBalanceOf(user1.address);
      const finalCollateral = await comet.userCollateral(user1.address, COMP.address);

      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      expect(finalCollateral.balance.toBigInt()).to.be.lt(initialCollateral.balance.toBigInt());
      expect(await comet.isLiquidatable(user1.address)).to.be.false;
    });

    it('should successfully absorb user with single collateral', async function () {
      const { COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      await COMP.connect(governor).transfer(user1.address, exp(100, 18));
      await COMP.connect(user1).approve(comet.address, exp(100, 18));
      await comet.connect(user1).supply(COMP.address, exp(100, 18));

      const borrowCapacity = await borrowCapacityForAsset(comet, user1, 0);
      await comet.connect(user1).withdraw(tokens.USDC.address, borrowCapacity);

      await makeLiquidatable(comet, user1, [{ feed: priceFeedCOMP, governor, percent: 10 }]);

      const initialCollateral = await comet.userCollateral(user1.address, COMP.address);
      const initialDebt = await comet.borrowBalanceOf(user1.address);
      expect(await comet.isLiquidatable(user1.address)).to.be.true;

      await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();

      const finalCollateral = await comet.userCollateral(user1.address, COMP.address);
      const finalDebt = await comet.borrowBalanceOf(user1.address);

      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      expect(finalCollateral.balance.toBigInt()).to.be.lt(initialCollateral.balance.toBigInt());
      expect(await comet.isLiquidatable(user1.address)).to.be.false;
    });

    it('should perform full liquidation with single collateral', async function () {
      const { COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      await COMP.connect(governor).transfer(user1.address, exp(20, 18));
      await COMP.connect(user1).approve(comet.address, exp(20, 18));
      await comet.connect(user1).supply(COMP.address, exp(20, 18));

      const borrowCapacity = await borrowCapacityForAsset(comet, user1, 0);
      await comet.connect(user1).withdraw(tokens.USDC.address, borrowCapacity);

      await makeLiquidatable(comet, user1, [{ feed: priceFeedCOMP, governor, percent: 50 }]);

      expect(await comet.isLiquidatable(user1.address)).to.be.true;

      await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();

      const finalCOMP = await comet.userCollateral(user1.address, COMP.address);
      const finalDebt = await comet.borrowBalanceOf(user1.address);

      expect(finalDebt.toBigInt()).to.equal(0n);
      expect(finalCOMP.balance.toBigInt()).to.equal(0n);
      expect(await comet.isLiquidatable(user1.address)).to.be.false;
    });
  });

  // ── Multi-collateral COMP+WETH (price=50, LF=0.7) ────────────────────────

  describe('multi-collateral COMP+WETH scenarios', function() {
    let comet: CometInterface;
    let tokens: any, priceFeeds: any, governor: SignerWithAddress;
    let user1: SignerWithAddress, liquidator: SignerWithAddress;
    let snapshotId: string;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(1e6, 6), decimals: 6, initialPrice: 1 },
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
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      [user1, liquidator] = protocol.users;

      await tokens.USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
      await tokens.USDC.connect(liquidator).approve(comet.address, exp(10000, 6));
      await comet.connect(liquidator).supply(tokens.USDC.address, exp(10000, 6));

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('should successfully absorb user with multiple collaterals', async function () {
      const { COMP, WETH } = tokens;
      const { COMP: priceFeedCOMP, WETH: priceFeedWETH } = priceFeeds;

      await COMP.connect(governor).transfer(user1.address, exp(50, 18));
      await COMP.connect(user1).approve(comet.address, exp(50, 18));
      await comet.connect(user1).supply(COMP.address, exp(50, 18));

      await WETH.connect(governor).transfer(user1.address, exp(1, 18));
      await WETH.connect(user1).approve(comet.address, exp(1, 18));
      await comet.connect(user1).supply(WETH.address, exp(1, 18));

      const totalBorrow = (await borrowCapacityForAsset(comet, user1, 0))
        .add(await borrowCapacityForAsset(comet, user1, 1));
      await comet.connect(user1).withdraw(tokens.USDC.address, totalBorrow);

      await makeLiquidatable(comet, user1, [
        { feed: priceFeedCOMP, governor, percent: 10 },
        { feed: priceFeedWETH, governor, percent: 10 },
      ]);

      const initialCOMP = await comet.userCollateral(user1.address, COMP.address);
      const initialWETH = await comet.userCollateral(user1.address, WETH.address);
      const initialDebt = await comet.borrowBalanceOf(user1.address);
      expect(await comet.isLiquidatable(user1.address)).to.be.true;

      await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();

      const finalCOMP = await comet.userCollateral(user1.address, COMP.address);
      const finalWETH = await comet.userCollateral(user1.address, WETH.address);
      const finalDebt = await comet.borrowBalanceOf(user1.address);

      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      expect(
        finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt() ||
        finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt()
      ).to.be.true;
      expect(await comet.isLiquidatable(user1.address)).to.be.false;
    });

    it('should successfully absorb user with insufficient collaterals', async function () {
      const { COMP, WETH } = tokens;
      const { COMP: priceFeedCOMP, WETH: priceFeedWETH } = priceFeeds;

      await COMP.connect(governor).transfer(user1.address, exp(15, 18));
      await COMP.connect(user1).approve(comet.address, exp(15, 18));
      await comet.connect(user1).supply(COMP.address, exp(15, 18));

      await WETH.connect(governor).transfer(user1.address, exp(0.1, 18));
      await WETH.connect(user1).approve(comet.address, exp(0.1, 18));
      await comet.connect(user1).supply(WETH.address, exp(0.1, 18));

      const totalBorrow = (await borrowCapacityForAsset(comet, user1, 0))
        .add(await borrowCapacityForAsset(comet, user1, 1));
      await comet.connect(user1).withdraw(tokens.USDC.address, totalBorrow);

      await makeLiquidatable(comet, user1, [
        { feed: priceFeedCOMP, governor, percent: 20 },
        { feed: priceFeedWETH, governor, percent: 20 },
      ]);

      const initialCOMP = await comet.userCollateral(user1.address, COMP.address);
      const initialWETH = await comet.userCollateral(user1.address, WETH.address);
      const initialDebt = await comet.borrowBalanceOf(user1.address);
      expect(await comet.isLiquidatable(user1.address)).to.be.true;

      await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();

      const finalCOMP = await comet.userCollateral(user1.address, COMP.address);
      const finalWETH = await comet.userCollateral(user1.address, WETH.address);
      const finalDebt = await comet.borrowBalanceOf(user1.address);

      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      expect(
        finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt() ||
        finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt()
      ).to.be.true;
      expect(await comet.isLiquidatable(user1.address)).to.be.false;
    });
  });

  // ── Multi-collateral COMP+WETH+WBTC ──────────────────────────────────────

  describe('multi-collateral COMP+WETH+WBTC scenarios', function() {
    let comet: CometInterface;
    let tokens: any, priceFeeds: any, governor: SignerWithAddress;
    let user1: SignerWithAddress, liquidator: SignerWithAddress;
    let snapshotId: string;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(1e6, 6), decimals: 6, initialPrice: 1 },
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
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      [user1, liquidator] = protocol.users;

      await tokens.USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
      await tokens.USDC.connect(liquidator).approve(comet.address, exp(10000, 6));
      await comet.connect(liquidator).supply(tokens.USDC.address, exp(10000, 6));

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('should successfully absorb user with multiple collaterals - sufficient last collateral only', async function () {
      const { COMP, WETH, WBTC } = tokens;
      const { COMP: priceFeedCOMP, WETH: priceFeedWETH, WBTC: priceFeedWBTC } = priceFeeds;

      await COMP.connect(governor).transfer(user1.address, exp(20, 18));
      await COMP.connect(user1).approve(comet.address, exp(20, 18));
      await comet.connect(user1).supply(COMP.address, exp(20, 18));

      await WETH.connect(governor).transfer(user1.address, exp(0.2, 18));
      await WETH.connect(user1).approve(comet.address, exp(0.2, 18));
      await comet.connect(user1).supply(WETH.address, exp(0.2, 18));

      await WBTC.connect(governor).transfer(user1.address, exp(0.02, 8));
      await WBTC.connect(user1).approve(comet.address, exp(0.02, 8));
      await comet.connect(user1).supply(WBTC.address, exp(0.02, 8));

      const totalBorrow = (await borrowCapacityForAsset(comet, user1, 0))
        .add(await borrowCapacityForAsset(comet, user1, 1))
        .add(await borrowCapacityForAsset(comet, user1, 2));
      await comet.connect(user1).withdraw(tokens.USDC.address, totalBorrow);

      await makeLiquidatable(comet, user1, [
        { feed: priceFeedCOMP, governor, percent: 30 },
        { feed: priceFeedWETH, governor, percent: 30 },
        { feed: priceFeedWBTC, governor, percent: 5 },
      ]);

      const initialCOMP = await comet.userCollateral(user1.address, COMP.address);
      const initialWETH = await comet.userCollateral(user1.address, WETH.address);
      const initialWBTC = await comet.userCollateral(user1.address, WBTC.address);
      const initialDebt = await comet.borrowBalanceOf(user1.address);
      expect(await comet.isLiquidatable(user1.address)).to.be.true;

      await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();

      const finalCOMP = await comet.userCollateral(user1.address, COMP.address);
      const finalWETH = await comet.userCollateral(user1.address, WETH.address);
      const finalWBTC = await comet.userCollateral(user1.address, WBTC.address);
      const finalDebt = await comet.borrowBalanceOf(user1.address);

      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      expect(
        finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt() ||
        finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt() ||
        finalWBTC.balance.toBigInt() < initialWBTC.balance.toBigInt()
      ).to.be.true;
      expect(await comet.isLiquidatable(user1.address)).to.be.false;
    });

    it('should successfully absorb user with multiple collaterals - insufficient last collateral', async function () {
      const { COMP, WETH, WBTC } = tokens;
      const { COMP: priceFeedCOMP, WETH: priceFeedWETH, WBTC: priceFeedWBTC } = priceFeeds;

      await COMP.connect(governor).transfer(user1.address, exp(10, 18));
      await COMP.connect(user1).approve(comet.address, exp(10, 18));
      await comet.connect(user1).supply(COMP.address, exp(10, 18));

      await WETH.connect(governor).transfer(user1.address, exp(0.1, 18));
      await WETH.connect(user1).approve(comet.address, exp(0.1, 18));
      await comet.connect(user1).supply(WETH.address, exp(0.1, 18));

      await WBTC.connect(governor).transfer(user1.address, exp(0.001, 8));
      await WBTC.connect(user1).approve(comet.address, exp(0.001, 8));
      await comet.connect(user1).supply(WBTC.address, exp(0.001, 8));

      const totalBorrow = (await borrowCapacityForAsset(comet, user1, 0))
        .add(await borrowCapacityForAsset(comet, user1, 1))
        .add(await borrowCapacityForAsset(comet, user1, 2));
      await comet.connect(user1).withdraw(tokens.USDC.address, totalBorrow);

      await makeLiquidatable(comet, user1, [
        { feed: priceFeedCOMP, governor, percent: 40 },
        { feed: priceFeedWETH, governor, percent: 40 },
        { feed: priceFeedWBTC, governor, percent: 40 },
      ]);

      const initialCOMP = await comet.userCollateral(user1.address, COMP.address);
      const initialWETH = await comet.userCollateral(user1.address, WETH.address);
      const initialWBTC = await comet.userCollateral(user1.address, WBTC.address);
      const initialDebt = await comet.borrowBalanceOf(user1.address);
      expect(await comet.isLiquidatable(user1.address)).to.be.true;

      await (await comet.connect(liquidator).absorb(liquidator.address, [user1.address])).wait();

      const finalCOMP = await comet.userCollateral(user1.address, COMP.address);
      const finalWETH = await comet.userCollateral(user1.address, WETH.address);
      const finalWBTC = await comet.userCollateral(user1.address, WBTC.address);
      const finalDebt = await comet.borrowBalanceOf(user1.address);

      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      expect(
        finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt() ||
        finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt() ||
        finalWBTC.balance.toBigInt() < initialWBTC.balance.toBigInt()
      ).to.be.true;
      expect(await comet.isLiquidatable(user1.address)).to.be.false;
    });
  });

  // ── Partial liquidation arithmetic (COMP price=1, LF=0.9, baseTracking=0) ─

  describe('partial liquidation arithmetic', function() {
    let comet: CometInterface;
    let tokens: any, priceFeeds: any, governor: SignerWithAddress;
    let supplier: SignerWithAddress, borrower: SignerWithAddress, liquidator: SignerWithAddress;
    let snapshotId: string;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 1,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1e6, 18),
          },
          WETH: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 2000,
            borrowCF: exp(0.75, 18),
            liquidateCF: exp(0.80, 18),
            liquidationFactor: exp(0.85, 18),
            supplyCap: exp(1e4, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      [supplier, borrower, liquidator] = protocol.users;

      await tokens.USDC.connect(governor).transfer(supplier.address, exp(1_000_000, 6));
      await tokens.USDC.connect(supplier).approve(comet.address, exp(1_000_000, 6));
      await comet.connect(supplier).supply(tokens.USDC.address, exp(1_000_000, 6));

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('should correctly calculate newBalance and newPrincipal in absorbInternal', async function () {
      const { USDC, COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      const compAmount = exp(100, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      const borrowAmount = exp(80, 6);
      await comet.connect(borrower).withdraw(USDC.address, borrowAmount);

      await setPrice(priceFeedCOMP, governor, 0.93);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      const userBasicBefore = await comet.userBasic(borrower.address);
      const oldPrincipal = userBasicBefore.principal;

      const totalsBasic = await comet.totalsBasic();
      const baseBorrowIndex = totalsBasic.baseBorrowIndex.toBigInt();
      const baseSupplyIndex = totalsBasic.baseSupplyIndex.toBigInt();
      const baseScale = (await comet.baseScale()).toBigInt();
      const factorScale = (await comet.factorScale()).toBigInt();
      const BASE_INDEX_SCALE = 1000000000000000n;

      const oldPrincipalAbs = -BigInt(oldPrincipal.toString());
      const oldBalanceCalculated = -(oldPrincipalAbs * baseBorrowIndex / BASE_INDEX_SCALE);
      console.log('oldPrincipal:', oldPrincipal.toString());
      console.log('oldBalance (calculated):', oldBalanceCalculated.toString());

      const absorbTx = await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);
      const receipt = await absorbTx.wait();

      const absorbCollateralEvents = receipt.logs
        .map(log => {
          try { return comet.interface.parseLog(log); } catch { return null; }
        })
        .filter(parsed => parsed && parsed.name === 'AbsorbCollateral');

      expect(absorbCollateralEvents.length).to.be.gt(0, 'Should have AbsorbCollateral events');

      let deltaValueManual = 0n;
      const compPrice = BigInt(exp(0.93, 8));
      const compScale = BigInt(exp(1, 18));
      const liquidationFactor = BigInt(exp(0.9, 18));

      for (const event of absorbCollateralEvents) {
        if (!event || !event.args) { console.log('Warning: Event or args is null, skipping'); continue; }
        const asset = event.args[2];
        const seizeAmount = BigInt(event.args[3]);
        if (asset === COMP.address) {
          const collateralValue = seizeAmount * compPrice / compScale;
          const seizedValue = collateralValue * liquidationFactor / factorScale;
          deltaValueManual += seizedValue;
          console.log('Seized COMP amount:', seizeAmount.toString());
          console.log('Collateral value (price scale):', collateralValue.toString());
          console.log('Seized value (price scale):', seizedValue.toString());
        }
      }

      console.log('deltaValue (manual):', deltaValueManual.toString());

      const basePrice = BigInt(exp(1, 8));
      const deltaBalanceManual = deltaValueManual * baseScale / basePrice;
      console.log('deltaBalance (manual):', deltaBalanceManual.toString());

      const newBalanceExpected = oldBalanceCalculated + deltaBalanceManual;
      console.log('newBalance (expected):', newBalanceExpected.toString());

      let newPrincipalExpected: bigint;
      if (newBalanceExpected >= 0n) {
        newPrincipalExpected = (newBalanceExpected * BASE_INDEX_SCALE) / baseSupplyIndex;
        console.log('newBalance is positive, user becomes supplier');
      } else {
        const absPresentValue = -newBalanceExpected;
        newPrincipalExpected = -((absPresentValue * BASE_INDEX_SCALE + baseBorrowIndex - 1n) / baseBorrowIndex);
        console.log('newBalance is negative, user still has debt');
      }

      console.log('newPrincipal (expected):', newPrincipalExpected.toString());

      const userBasicAfter = await comet.userBasic(borrower.address);
      const newPrincipalActual = userBasicAfter.principal.toBigInt();

      let newBalanceActual: bigint;
      if (newPrincipalActual >= 0n) {
        newBalanceActual = newPrincipalActual * baseSupplyIndex / BASE_INDEX_SCALE;
      } else {
        const absPrincipal = -newPrincipalActual;
        newBalanceActual = -(absPrincipal * baseBorrowIndex / BASE_INDEX_SCALE);
      }

      console.log('newPrincipal (actual):', newPrincipalActual.toString());
      console.log('newBalance (actual):', newBalanceActual.toString());

      const balanceDiff = newBalanceActual > newBalanceExpected
        ? newBalanceActual - newBalanceExpected
        : newBalanceExpected - newBalanceActual;
      const principalDiff = newPrincipalActual > newPrincipalExpected
        ? newPrincipalActual - newPrincipalExpected
        : newPrincipalExpected - newPrincipalActual;

      console.log('Balance difference:', balanceDiff.toString());
      console.log('Principal difference:', principalDiff.toString());

      expect(balanceDiff).to.be.lte(1n);
      expect(principalDiff).to.be.lte(1n);
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });

    it('should verify partial seizure formula accuracy: seizeAmount and HF match theory', async function () {
      const { USDC, COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      const compAmount = exp(100, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);
      await comet.connect(borrower).withdraw(USDC.address, exp(80, 6));

      await setPrice(priceFeedCOMP, governor, 0.93);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      const FACTOR_SCALE = BigInt(exp(1, 18));
      const priceScale = BigInt(exp(1, 8));
      const compScale = BigInt(exp(1, 18));
      const baseScale = BigInt(exp(1, 6));
      const targetHF = BigInt(exp(1.05, 18));
      const LP = BigInt(exp(0.9, 18));
      const CF = BigInt(exp(0.8, 18));
      const compPrice = BigInt(exp(0.93, 8));

      const debtUSD = BigInt(exp(80, 6)) * priceScale / baseScale;
      const tcv = compAmount * compPrice * CF / compScale / FACTOR_SCALE;
      const denom = LP * targetHF / FACTOR_SCALE - CF;
      const rawCollateralUSD = (debtUSD * targetHF / FACTOR_SCALE - tcv) * FACTOR_SCALE / denom;

      const remainingBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      expect(remainingBalance.toBigInt()).to.be.gt(0n, 'Should be partial liquidation with remaining COMP');

      const newTCV = tcv - rawCollateralUSD * CF / FACTOR_SCALE;
      const newDebt = debtUSD - rawCollateralUSD * LP / FACTOR_SCALE;
      const actualHF = newTCV * FACTOR_SCALE / newDebt;
      const hfDiff = actualHF > targetHF ? actualHF - targetHF : targetHF - actualHF;
      expect(hfDiff).to.be.lte(BigInt(exp(0.001, 18)), 'HF after absorb should equal targetHF within 0.1%');

      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });

    it('should handle multi-collateral: full seizure of first asset then partial of second', async function () {
      const { USDC, COMP, WETH } = tokens;
      const { COMP: priceFeedCOMP, WETH: priceFeedWETH } = priceFeeds;

      const compAmount = exp(10, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      const wethAmount = exp(1, 18);
      await WETH.connect(governor).transfer(borrower.address, wethAmount);
      await WETH.connect(borrower).approve(comet.address, wethAmount);
      await comet.connect(borrower).supply(WETH.address, wethAmount);

      const totalBorrow = (await borrowCapacityForAsset(comet, borrower, 0))
        .add(await borrowCapacityForAsset(comet, borrower, 1));
      await comet.connect(borrower).withdraw(USDC.address, totalBorrow);

      await setPrice(priceFeedCOMP, governor, 0.5);
      await setPrice(priceFeedWETH, governor, 1800);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      const initialWethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      const finalCompBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      const finalWethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance;

      expect(finalCompBalance.toBigInt()).to.equal(0n, 'COMP should be fully seized');
      expect(finalWethBalance.toBigInt()).to.be.gt(0n, 'WETH should be partially seized, not fully');
      expect(finalWethBalance.toBigInt()).to.be.lt(initialWethBalance.toBigInt(), 'WETH balance should decrease');
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });

    it('should do full liquidation when all collateral exhausted without reaching targetHF', async function () {
      const { USDC, COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      const compAmount = exp(100, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);
      await comet.connect(borrower).withdraw(USDC.address, exp(80, 6));

      await setPrice(priceFeedCOMP, governor, 0.10);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      const finalCompBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      expect(finalCompBalance.toBigInt()).to.equal(0n, 'All COMP should be seized');

      const finalDebt = await comet.borrowBalanceOf(borrower.address);
      expect(finalDebt.toBigInt()).to.equal(0n, 'Debt should be zeroed by reserves after full liquidation');
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });
});
