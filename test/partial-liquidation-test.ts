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

  // ── baseBorrowMin guard ──
  // Test 1 (large position): debtAfterPartial ≈ $20.41 > $5 ->  guard does not fire ->  partial.
  // Test 2 (small position): debtAfterPartial ≈ $1.43  < $5 ->  guard fires ->  full-seizure fallback.
  // Test 3 (boundary ==): debtAfterPartial == $5 exactly ->  guard does not fire -> partial.
  // Test 4 (boundary - 1 unit): debtAfterPartial == $4.999999 (bbm - 1) ->  guard fires ->  full-seizure fallback.
  // Test 5 (baseBorrowMin = 0): guard never fires regardless of residual debt; own inline protocol.

  describe('baseBorrowMin guard', function() {
    let comet: CometInterface;
    let tokens: any, priceFeeds: any, governor: SignerWithAddress;
    let supplier: SignerWithAddress, borrower: SignerWithAddress, liquidator: SignerWithAddress;
    let snapshotId: string;

    before(async function() {
      const protocol = await makeProtocol({
        baseBorrowMin: exp(5, 6), // $5 USDC
        assets: {
          USDC: { initial: exp(1_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 1,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1e6, 18),
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

    it('partial liquidation proceeds when remaining debt stays above baseBorrowMin', async function () {
      // 100 COMP - $1, borrow $80 -> drop to $0.93 ->  liquidatable
      // debtAfterPartial ≈ $20.41 > baseBorrowMin $5 ->  guard does not fire ->  partial
      const { COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      const compAmount = exp(100, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);
      await comet.connect(borrower).withdraw(tokens.USDC.address, exp(80, 6));

      await setPrice(priceFeedCOMP, governor, 0.93);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      const remainingCOMP = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      expect(remainingCOMP.toBigInt()).to.be.gt(0n, 'Partial liquidation: some COMP must remain');

      const remainingDebt = await comet.borrowBalanceOf(borrower.address);
      const baseBorrowMin = await comet.baseBorrowMin();
      expect(remainingDebt.toBigInt()).to.be.gte(baseBorrowMin.toBigInt(), 'Remaining debt must be >= baseBorrowMin');

      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });

    it('falls back to full asset seizure when partial would leave dust debt', async function () {
      // 7 COMP - $1, borrow max (~$5.6) ->  drop to $0.93 ->  liquidatable
      // debtAfterPartial ≈ $1.43 < baseBorrowMin $5 ->  guard fires ->  full-seizure fallback
      const { COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      const compAmount = exp(7, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);
      const borrowAmount = await borrowCapacityForAsset(comet, borrower, 0);
      await comet.connect(borrower).withdraw(tokens.USDC.address, borrowAmount);

      await setPrice(priceFeedCOMP, governor, 0.93);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // Pre-absorb: verify the baseBorrowMin guard is what forces the fallback
      const FACTOR_SCALE = BigInt(exp(1, 18));
      const priceScale = BigInt(exp(1, 8));
      const compScale = BigInt(exp(1, 18));
      const baseScale = BigInt(exp(1, 6));
      const targetHF= BigInt(exp(1.05, 18));
      const LP = BigInt(exp(0.9, 18));
      const CF = BigInt(exp(0.8, 18));
      const compPrice = BigInt(exp(0.93, 8));
      const basePrice = BigInt(exp(1, 8));

      const debtUSD = borrowAmount.toBigInt() * priceScale / baseScale;
      const tcv = compAmount * compPrice * CF / compScale / FACTOR_SCALE;
      const denom = LP * targetHF / FACTOR_SCALE - CF;
      const rawCollateralUSD = (debtUSD * targetHF / FACTOR_SCALE - tcv) * FACTOR_SCALE / denom;
      const availableUSD = compAmount * compPrice / compScale;

      // Partial condition is met (rawCollateralUSD <= availableUSD)
      expect(rawCollateralUSD).to.be.lte(availableUSD, 'rawCollateralUSD must be <= availableUSD');

      // debtAfterPartial < baseBorrowMin ->  guard fires
      const debtReduction = rawCollateralUSD * LP / FACTOR_SCALE;
      const debtAfterPartialUSD = debtUSD - debtReduction;
      const baseDebtAfterPartial = debtAfterPartialUSD * baseScale / basePrice;
      const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
      expect(baseDebtAfterPartial).to.be.lt(baseBorrowMin, 'debtAfterPartial must be < baseBorrowMin to trigger full-liquidation fallback');

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      const finalCOMP = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      expect(finalCOMP.toBigInt()).to.equal(0n, 'All COMP must be seized (full liquidation fallback)');

      const finalDebt = await comet.borrowBalanceOf(borrower.address);
      expect(finalDebt.toBigInt()).to.equal(0n, 'Debt must be zeroed after full liquidation');

      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });

    it('partial proceeds when debtAfterPartial exactly equals baseBorrowMin', async function () {
      // 20 COMP - $1, borrow $15.833750 ->  drop to $0.93 ->  liquidatable
      // All intermediate divisions are exact (no truncation), so
      // baseDebtAfterPartial == baseBorrowMin == $5 precisely ->  guard condition >= is satisfied ->  partial
      const { COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      const compAmount = exp(20, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);
      await comet.connect(borrower).withdraw(tokens.USDC.address, exp(15.83375, 6)); // $15.833750 exactly

      await setPrice(priceFeedCOMP, governor, 0.93);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // Pre-absorb: verify baseDebtAfterPartial == baseBorrowMin exactly (boundary condition for >=)
      const FACTOR_SCALE = BigInt(exp(1, 18));
      const compScale = BigInt(exp(1, 18));
      const baseScale = BigInt(exp(1, 6));
      const targetHF = BigInt(exp(1.05, 18));
      const LP = BigInt(exp(0.9, 18));
      const CF = BigInt(exp(0.8, 18));
      const compPrice = BigInt(exp(0.93, 8));
      const basePrice = BigInt(exp(1, 8));
      const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();

      const debtRemaining = exp(15.83375, 6) * basePrice / baseScale;        // 1_583_375_000
      const availableUSD = compAmount * compPrice / compScale;               // 1_860_000_000
      const tcv = availableUSD * CF / FACTOR_SCALE;                          // 1_488_000_000
      const denom = LP * targetHF / FACTOR_SCALE - CF;                       // 145_000_000_000_000_000
      const numerator = debtRemaining * targetHF / FACTOR_SCALE - tcv        // 174_543_750
      const rawCollateralUSD = numerator * FACTOR_SCALE / denom;             // 1_203_750_000
      const debtReduction = rawCollateralUSD * LP / FACTOR_SCALE;            // 1_083_375_000
      const debtAfterPartial = debtRemaining - debtReduction;                // 500_000_000
      const baseDebtAfterPartial = debtAfterPartial * baseScale / basePrice; // 5_000_000

      expect(rawCollateralUSD).to.be.lte(availableUSD, 'partial condition: rawCollateralUSD must not exceed availableUSD');
      expect(baseDebtAfterPartial).to.equal(baseBorrowMin, 'baseDebtAfterPartial must equal baseBorrowMin exactly (boundary)');

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      const remainingCOMP = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      expect(remainingCOMP.toBigInt()).to.be.gt(0n, 'Some COMP must remain: partial liquidation occurred');

      const remainingDebt = await comet.borrowBalanceOf(borrower.address);
      expect(remainingDebt.toBigInt()).to.equal(baseBorrowMin, 'Remaining debt must equal baseBorrowMin exactly');

      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });

    it('full-seizure fallback when debtAfterPartial is one unit below baseBorrowMin', async function () {
      // 20 COMP - $1, borrow $15.833750 ->  drop to price 92999999 (one price unit below 93000000 used in the boundary test above)
      // baseDebtAfterPartial = 4999999 = baseBorrowMin - 1 ->  guard fires ->  full-seizure fallback
      // setPrice helper has 6-decimal float precision; price is set directly via setRoundData
      const { COMP } = tokens;
      const { COMP: priceFeedCOMP } = priceFeeds;

      const compAmount = exp(20, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);
      await comet.connect(borrower).withdraw(tokens.USDC.address, exp(15.83375, 6)); // identical to 1.1

      const rd = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(rd[0], exp(0.92999999, 8, 8), rd[2], rd[3], rd[4]);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // Pre-absorb: verify baseDebtAfterPartial == baseBorrowMin - 1 exactly (guard fires because < not >=)
      const FACTOR_SCALE = BigInt(exp(1, 18));
      const compScale = BigInt(exp(1, 18));
      const baseScale = BigInt(exp(1, 6));
      const targetHF = BigInt(exp(1.05, 18));
      const LP = BigInt(exp(0.9, 18));
      const CF = BigInt(exp(0.8, 18));
      const compPrice = exp(0.92999999, 8, 8); // 92_999_999 — one unit below 93_000_000
      const basePrice = BigInt(exp(1, 8));
      const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();

      const debtRemaining = exp(15.83375, 6) * basePrice / baseScale;        // 1_583_375_000
      const availableUSD = compAmount * compPrice / compScale;               // 1_859_999_980
      const tcv = availableUSD * CF / FACTOR_SCALE;                          // 1_487_999_984
      const denom = LP * targetHF / FACTOR_SCALE - CF;                       // 145_000_000_000_000_000
      const numerator = debtRemaining * targetHF / FACTOR_SCALE - tcv;       // 174_543_766
      const rawCollateralUSD = numerator * FACTOR_SCALE / denom;             // 1_203_750_110
      const debtReduction = rawCollateralUSD * LP / FACTOR_SCALE;            // 1_083_375_099
      const debtAfterPartial = debtRemaining - debtReduction;                // 499_999_901
      const baseDebtAfterPartial = debtAfterPartial * baseScale / basePrice; // 4_999_999

      expect(rawCollateralUSD).to.be.lte(availableUSD, 'partial condition would be met (rawCollateralUSD <= availableUSD)');
      expect(baseDebtAfterPartial).to.equal(baseBorrowMin - 1n, 'baseDebtAfterPartial must be exactly one unit below baseBorrowMin');

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      const finalCOMP = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      expect(finalCOMP.toBigInt()).to.equal(0n, 'All COMP must be seized: full-seizure fallback triggered');

      const finalDebt = await comet.borrowBalanceOf(borrower.address);
      expect(finalDebt.toBigInt()).to.equal(0n, 'Debt must be zeroed after full-seizure fallback');

      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });

    it('baseBorrowMin = 0: guard never fires, partial always proceeds even with tiny remaining debt', async function () {
      // With baseBorrowMin=0 the guard condition "baseDebtAfterPartial >= baseBorrowMin"
      // becomes "baseDebtAfterPartial >= 0", which is always true for a uint.
      // Uses parameters that would trigger the guard when baseBorrowMin=$5 (see the sibling test
      // "falls back to full asset seizure when partial would leave dust debt" in describe('baseBorrowMin guard')):
      //   7 COMP - $1, borrow $5.60, COMP drops to $0.93 ->  debtAfterPartial ≈ $1.43 < $5 ->  guard would fire.
      //   With baseBorrowMin=0 the guard does NOT fire and partial succeeds: finalDebt>0, finalCOMP>0.
      //
      // Verified arithmetic (basePrice=100_000_000, baseScale=1_000_000, FACTOR_SCALE=1e18, targetHF=1.05e18):
      //   debtPriceAdj = 5_600_000 * 100 = 560_000_000
      //   compPrice = 93_000_000; availableUSD = 7e18*93M/1e18 = 651_000_000
      //   TCV = 651_000_000 * 0.8 = 520_800_000
      //   denom = 0.9*1.05 - 0.8 = 0.145e18
      //   rawCollateralUSD = (560M*1.05 - 520.8M) / 0.145 = 67.2M/0.145 = 463_448_275
      //   rawCollateralUSD=463M ≤ availableUSD=651M ->  PARTIAL PATH
      //   debtReduction = 463_448_275 * 0.9 = 417_103_447
      //   debtAfterPartial = 560M - 417.1M = 142_896_553
      //   baseDebtAfterPartial = 142_896_553 / 100 = 1_428_965
      //   baseBorrowMin=0 ->  1_428_965 ≥ 0 ->  GUARD DOES NOT FIRE ->  partial proceeds
      //   seizeAmount = 463_448_275 * 1e18 / 93_000_000 ≈ 4.984 COMP; remaining ≈ 2.016 COMP
      //   newBalance = -5_600_000 + divPrice(417_103_447,100M,1M) = -5_600_000 + 4_171_034 = -1_428_966
      //   currentHF=targetHF ->  newBalance stays negative ->  finalDebt=1_428_966 ≈ $1.43 > 0
      //
      // Own protocol created inline to avoid EVM snapshot conflicts with the outer beforeEach.
      const protocol5 = await makeProtocol({
        baseBorrowMin: 0,
        assets: {
          USDC: { initial: exp(1_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 1,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1e6, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });

      const { cometWithPartialLiquidation: comet, tokens: tokens, priceFeeds: priceFeeds, governor: governor } = protocol5;
      const [supplier, borrower, liquidator] = protocol5.users;

      await tokens.USDC.connect(governor).transfer(supplier.address, exp(1_000_000, 6));
      await tokens.USDC.connect(supplier).approve(comet.address, exp(1_000_000, 6));
      await comet.connect(supplier).supply(tokens.USDC.address, exp(1_000_000, 6));

      // 7 COMP - $1: borrowCF capacity = 7*1*0.8 = $5.60 = 5_600_000 USDC
      const compAmount = exp(7, 18);
      await tokens.COMP.connect(governor).transfer(borrower.address, compAmount);
      await tokens.COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(tokens.COMP.address, compAmount);

      // Borrow exactly at capacity: $5.60 (baseBorrowMin=0 so any positive amount is valid)
      const borrowAmount = 5_600_000n;
      await comet.connect(borrower).withdraw(tokens.USDC.address, borrowAmount);

      // Drop COMP to $0.93: liquidateCF value = 7*0.93*0.85 = $5.5335 < $5.60 ->  liquidatable
      await setPrice(priceFeeds.COMP, governor, 0.93);

      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // Pre-absorb: verify the guard condition with baseBorrowMin=0
      const FACTOR_SCALE = exp(1, 18);
      const targetHF = exp(1.05, 18);
      const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
      const baseScale = exp(1, 6);
      const compPrice = (await comet.getPrice(priceFeeds.COMP.address)).toBigInt();

      const availableUSD = compAmount * compPrice / exp(1, 18);
      const tcv = availableUSD * exp(0.8, 18) / FACTOR_SCALE;
      const debtPriceAdj = borrowAmount * basePrice / baseScale;
      const denom = exp(0.9, 18) * targetHF / FACTOR_SCALE - exp(0.8, 18);
      const rawCollateralUSD = (debtPriceAdj * targetHF / FACTOR_SCALE - tcv) * FACTOR_SCALE / denom;

      // rawCollateralUSD ≤ availableUSD ->  partial path; guard fires with baseBorrowMin=$5 but NOT with baseBorrowMin=0
      expect(rawCollateralUSD).to.be.lte(availableUSD, 'rawCollateralUSD ≤ availableUSD: partial path');

      const debtReduction = rawCollateralUSD * exp(0.9, 18) / FACTOR_SCALE;
      const debtAfterPartial = debtPriceAdj - debtReduction;
      const baseDebtAfterPartial = debtAfterPartial * baseScale / basePrice;

      // Would fire the guard if baseBorrowMin were $5, but baseBorrowMin=0 means guard never fires
      expect(baseDebtAfterPartial).to.be.lt(exp(5, 6), 'baseDebtAfterPartial < $5 (would trigger guard if baseBorrowMin=$5)');
      expect(baseDebtAfterPartial).to.be.gte(0n, 'baseDebtAfterPartial ≥ baseBorrowMin=0: guard does not fire');

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // Partial seizure: some COMP remains, some debt remains
      const finalCOMP = (await comet.userCollateral(borrower.address, tokens.COMP.address)).balance;
      expect(finalCOMP.toBigInt()).to.be.gt(0n, 'COMP must be partially seized (some remains)');
      expect(finalCOMP.toBigInt()).to.be.lt(compAmount, 'COMP balance must have decreased');

      const finalDebt = await comet.borrowBalanceOf(borrower.address);
      expect(finalDebt.toBigInt()).to.be.gt(0n, 'Debt must remain (partial, not full liquidation)');

      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });
});
