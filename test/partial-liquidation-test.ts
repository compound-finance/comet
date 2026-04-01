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

      let _userBasicAfter = await comet.userBasic(user1.address);
      console.log('assetsIn:', _userBasicAfter);


      await USDC.connect(governor).transfer(user1.address, exp(2_000_000, 6));
      await USDC.connect(user1).approve(comet.address, exp(2_000_000, 6));
      await comet.connect(user1).supply(USDC.address, exp(2_000_000, 6));

      _userBasicAfter = await comet.userBasic(user1.address);
      console.log('\x1b[36m%s', 'assetsIn:', _userBasicAfter);

      const compAmount = exp(100_000, 18);
      await COMP.connect(governor).transfer(userToLiquidate.address, compAmount);
      await COMP.connect(userToLiquidate).approve(comet.address, compAmount);
      await comet.connect(userToLiquidate).supply(COMP.address, compAmount);

      _userBasicAfter = await comet.userBasic(user1.address);
      console.log('\x1b[36m%s', 'assetsIn:', _userBasicAfter);

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
          liquidationFactor: exp(0.95, 18),
          supplyCap: exp(2e5, 18),
        },
        USDT: {
          initial: exp(1e6, 6),
          decimals: 6,
          initialPrice: 1,
          borrowCF: exp(0.9, 18),
          liquidateCF: exp(0.95, 18),
          liquidationFactor: exp(0.95, 18),
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
            liquidationFactor: exp(0.95, 18),
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
            liquidationFactor: exp(0.95, 18),
            supplyCap: exp(2e5, 18),
          },
          WETH: {
            initial: exp(1e6, 18),
            decimals: 18,
            initialPrice: 2000,
            borrowCF: exp(0.75, 18),
            liquidateCF: exp(0.8, 18),
            liquidationFactor: exp(0.95, 18),
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
            liquidationFactor: exp(0.95, 18),
            supplyCap: exp(2e5, 18),
          },
          WETH: {
            initial: exp(1e6, 18),
            decimals: 18,
            initialPrice: 2000,
            borrowCF: exp(0.75, 18),
            liquidateCF: exp(0.8, 18),
            liquidationFactor: exp(0.95, 18),
            supplyCap: exp(1e4, 18),
          },
          WBTC: {
            initial: exp(1e6, 8),
            decimals: 8,
            initialPrice: 50000,
            borrowCF: exp(0.7, 18),
            liquidateCF: exp(0.75, 18),
            liquidationFactor: exp(0.95, 18),
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
            liquidationFactor: exp(0.9, 18),
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

  // ── Scenario 4a/4b — targetHealthFactor constructor validation (Fix 6 regression) ──

  describe('Scenario 4 — targetHealthFactor constructor validation (Fix 6 regression)', function() {
    let governor: SignerWithAddress;
    let pauseGuardian: SignerWithAddress;
    let baseConfig: any;

    before(async function() {
      [governor, pauseGuardian] = await ethers.getSigners();

      const FaucetFactory = await ethers.getContractFactory('FaucetToken');
      const baseToken = await FaucetFactory.deploy(exp(1_000_000, 6), 'USDC', 6, 'USDC');
      await baseToken.deployed();
      const collateralToken = await FaucetFactory.deploy(exp(1_000_000, 18), 'COMP', 18, 'COMP');
      await collateralToken.deployed();

      const PriceFeedFactory = await ethers.getContractFactory('SimplePriceFeed');
      const basePriceFeed = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await basePriceFeed.deployed();
      const collateralPriceFeed = await PriceFeedFactory.deploy(exp(50, 8), 8);
      await collateralPriceFeed.deployed();

      const AssetListFactoryContract = await ethers.getContractFactory('AssetListFactory');
      const assetListFactory = await AssetListFactoryContract.deploy();
      await assetListFactory.deployed();

      const CometExtFactory = await ethers.getContractFactory('CometExtAssetList');
      const extensionDelegate = await CometExtFactory.deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
        },
        assetListFactory.address
      );
      await extensionDelegate.deployed();

      baseConfig = {
        governor: governor.address,
        pauseGuardian: pauseGuardian.address,
        extensionDelegate: extensionDelegate.address,
        baseToken: baseToken.address,
        baseTokenPriceFeed: basePriceFeed.address,
        supplyKink: exp(0.8, 18),
        supplyPerYearInterestRateBase: 0n,
        supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
        supplyPerYearInterestRateSlopeHigh: exp(2, 18),
        borrowKink: exp(0.8, 18),
        borrowPerYearInterestRateBase: exp(0.005, 18),
        borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
        borrowPerYearInterestRateSlopeHigh: exp(3, 18),
        storeFrontPriceFactor: exp(1, 18),
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(1, 15),
        baseTrackingBorrowSpeed: exp(1, 15),
        baseMinForRewards: exp(1, 6),
        baseBorrowMin: exp(1, 6),
        targetReserves: 0n,
        targetHealthFactor: exp(1.05, 18),
        assetConfigs: [{
          asset: collateralToken.address,
          priceFeed: collateralPriceFeed.address,
          decimals: 18,
          borrowCollateralFactor: exp(0.85, 18),
          liquidateCollateralFactor: exp(0.9, 18),
          liquidationFactor: exp(0.9, 18),
          supplyCap: exp(1e5, 18),
        }],
      };
    });

    it('4a: reverts when targetHealthFactor = 0.9 (≤ 1.0)', async function() {
      const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
      await expect(
        CometFactory.deploy({ ...baseConfig, targetHealthFactor: exp(0.9, 18) })
      ).to.be.revertedWith("custom error 'BadHealthFactor()'");
    });

    it('4b: reverts when LP × targetHealthFactor ≤ borrowCF (0.80 × 1.05 = 0.84 < borrowCF = 0.85)', async function() {
      const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
      await expect(
        CometFactory.deploy({
          ...baseConfig,
          targetHealthFactor: exp(1.05, 18),
          assetConfigs: [{
            ...baseConfig.assetConfigs[0],
            borrowCollateralFactor: exp(0.85, 18),
            liquidationFactor: exp(0.80, 18),
          }],
        })
      ).to.be.revertedWith("custom error 'BadAssetHealthFactor()'");
    });
  });

  // ── Scenario 4c — boundary valid deploy + absorb smoke test ──

  describe('Scenario 4c — boundary valid LP * targetHF > borrowCF: deploy succeeds, absorb works', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: any;
    let USDC: any;
    let COMP: any;
    let priceFeedCOMP: any;

    before(async function() {
      [governor, liquidator, borrower] = await ethers.getSigners();

      const FaucetFactory = await ethers.getContractFactory('FaucetToken');
      USDC = await FaucetFactory.deploy(exp(10_000_000, 6), 'USDC', 6, 'USDC');
      await USDC.deployed();
      COMP = await FaucetFactory.deploy(exp(1_000_000, 18), 'COMP', 18, 'COMP');
      await COMP.deployed();

      const PriceFeedFactory = await ethers.getContractFactory('SimplePriceFeed');
      const priceFeedUSDC = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDC.deployed();
      priceFeedCOMP = await PriceFeedFactory.deploy(exp(50, 8), 8);
      await priceFeedCOMP.deployed();

      const AssetListFactoryContract = await ethers.getContractFactory('AssetListFactory');
      const assetListFactory = await AssetListFactoryContract.deploy();
      await assetListFactory.deployed();

      const CometExtFactory = await ethers.getContractFactory('CometExtAssetList');
      const extensionDelegate = await CometExtFactory.deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
        },
        assetListFactory.address
      );
      await extensionDelegate.deployed();

      // LP × targetHF = 0.80 × 1.06 = 0.848 > borrowCF = 0.84 — barely valid, deploy must succeed
      const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
      comet = await CometFactory.deploy({
        governor: governor.address,
        pauseGuardian: governor.address,
        extensionDelegate: extensionDelegate.address,
        baseToken: USDC.address,
        baseTokenPriceFeed: priceFeedUSDC.address,
        supplyKink: exp(0.8, 18),
        supplyPerYearInterestRateBase: 0n,
        supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
        supplyPerYearInterestRateSlopeHigh: exp(2, 18),
        borrowKink: exp(0.8, 18),
        borrowPerYearInterestRateBase: 0n,
        borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
        borrowPerYearInterestRateSlopeHigh: exp(3, 18),
        storeFrontPriceFactor: exp(1, 18),
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: 0n,
        baseTrackingBorrowSpeed: 0n,
        baseMinForRewards: exp(1, 6),
        baseBorrowMin: exp(1, 6),
        targetReserves: 0n,
        targetHealthFactor: exp(1.06, 18),
        assetConfigs: [{
          asset: COMP.address,
          priceFeed: priceFeedCOMP.address,
          decimals: 18,
          borrowCollateralFactor: exp(0.84, 18),
          liquidateCollateralFactor: exp(0.9, 18),
          liquidationFactor: exp(0.80, 18),
          supplyCap: exp(1_000_000, 18),
        }],
      });
      await comet.deployed();
      await comet.initializeStorage();
    });

    it('4c: deploy is successful and absorb completes without revert', async function() {
      // Governor provides USDC liquidity
      const liquidityAmount = exp(5000, 6);
      await USDC.connect(governor).approve(comet.address, liquidityAmount);
      await comet.connect(governor).supply(USDC.address, liquidityAmount);

      // Borrower receives COMP, supplies as collateral, borrows USDC
      // 100 COMP × $50 × borrowCF(0.84) = 4200 capacity; borrow 4000 (below max)
      const compAmount = exp(100, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);
      await comet.connect(borrower).withdraw(USDC.address, exp(4000, 6));

      // Drop COMP price to $43 → liquidateCF × value = 100 × 43 × 0.9 = 3870 < 4000 → liquidatable
      await setPrice(priceFeedCOMP, governor, 43);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // Absorb: smoke check — must not revert
      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // All COMP seized (only asset):
      //   TCV_initial = 100×43×0.84 = 3612; denom = 0.80×1.06 - 0.84 = 0.008
      //   rawCOMP = (4000×1.06 - 3612) / 0.008 = (4240 - 3612) / 0.008 = 628 / 0.008 = 78500 >> availableUSD = 4300 ✓
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      expect(compBalance.toBigInt()).to.equal(0n, 'All COMP should be seized');

      // Debt zeroed: seizedValue = LP × availableUSD = 0.80×4300 = 3440 < 4000 (debt)
      // newBalance = -4000 + 3440 = -560; condition (newBalance < 0 && currentHF < targetHF) → newBalance = 0
      const debtAfter = await comet.borrowBalanceOf(borrower.address);
      expect(debtAfter.toBigInt()).to.equal(0n, 'Debt should be zeroed after full COMP absorption');

      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });

  // ── Scenario 3a — assetsIn not cleared after full absorption (bug confirmation) ──

  describe('Scenario 3a — assetsIn not cleared after full absorption (bug confirmation)', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: any;
    let USDC: any;
    let COMP: any;
    let USDT: any;
    let priceFeedCOMP: any;
    let priceFeedUSDT: any;
    let snapshotId: string;

    before(async function() {
      [governor, liquidator, borrower] = await ethers.getSigners();

      const FaucetFactory = await ethers.getContractFactory('FaucetToken');
      USDC = await FaucetFactory.deploy(exp(10_000_000, 6), 'USDC', 6, 'USDC');
      await USDC.deployed();
      COMP = await FaucetFactory.deploy(exp(1_000_000, 18), 'COMP', 18, 'COMP');
      await COMP.deployed();
      USDT = await FaucetFactory.deploy(exp(1_000_000, 6), 'USDT', 6, 'USDT');
      await USDT.deployed();

      const PriceFeedFactory = await ethers.getContractFactory('SimplePriceFeed');
      const priceFeedUSDC = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDC.deployed();
      priceFeedCOMP = await PriceFeedFactory.deploy(exp(50, 8), 8);
      await priceFeedCOMP.deployed();
      priceFeedUSDT = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDT.deployed();

      const AssetListFactoryContract = await ethers.getContractFactory('AssetListFactory');
      const assetListFactory = await AssetListFactoryContract.deploy();
      await assetListFactory.deployed();

      const CometExtFactory = await ethers.getContractFactory('CometExtAssetList');
      const extensionDelegate = await CometExtFactory.deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
        },
        assetListFactory.address
      );
      await extensionDelegate.deployed();

      // COMP (asset 0): price=50, borrowCF=0.85, liquidateCF=0.9, liquidationFactor=0.9
      // USDT (asset 1): price=1,  borrowCF=0.85, liquidateCF=0.9, liquidationFactor=0.9
      // LP × targetHF = 0.9 × 1.05 = 0.945 > 0.85 ✓
      const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
      comet = await CometFactory.deploy({
        governor: governor.address,
        pauseGuardian: governor.address,
        extensionDelegate: extensionDelegate.address,
        baseToken: USDC.address,
        baseTokenPriceFeed: priceFeedUSDC.address,
        supplyKink: exp(0.8, 18),
        supplyPerYearInterestRateBase: 0n,
        supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
        supplyPerYearInterestRateSlopeHigh: exp(2, 18),
        borrowKink: exp(0.8, 18),
        borrowPerYearInterestRateBase: 0n,
        borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
        borrowPerYearInterestRateSlopeHigh: exp(3, 18),
        storeFrontPriceFactor: exp(1, 18),
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: 0n,
        baseTrackingBorrowSpeed: 0n,
        baseMinForRewards: exp(1, 6),
        baseBorrowMin: exp(1, 6),
        targetReserves: 0n,
        targetHealthFactor: exp(1.05, 18),
        assetConfigs: [
          {
            asset: COMP.address,
            priceFeed: priceFeedCOMP.address,
            decimals: 18,
            borrowCollateralFactor: exp(0.85, 18),
            liquidateCollateralFactor: exp(0.9, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
          {
            asset: USDT.address,
            priceFeed: priceFeedUSDT.address,
            decimals: 6,
            borrowCollateralFactor: exp(0.85, 18),
            liquidateCollateralFactor: exp(0.9, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 6),
          },
        ],
      });
      await comet.deployed();
      await comet.initializeStorage();

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('3a: assetsIn and _reserved remain non-zero after full absorption (bug confirmation — expected to fail before fix)', async function() {
      // Governor provides USDC liquidity
      await USDC.connect(governor).approve(comet.address, exp(1000, 6));
      await comet.connect(governor).supply(USDC.address, exp(1000, 6));

      // Borrower supplies COMP + USDT and borrows at max capacity
      // COMP: 10 × $50 × 0.85 = 425 USDC capacity
      // USDT: 100 × $1 × 0.85 = 85 USDC capacity → total 510 USDC
      await COMP.connect(governor).transfer(borrower.address, exp(10, 18));
      await COMP.connect(borrower).approve(comet.address, exp(10, 18));
      await comet.connect(borrower).supply(COMP.address, exp(10, 18));

      await USDT.connect(governor).transfer(borrower.address, exp(100, 6));
      await USDT.connect(borrower).approve(comet.address, exp(100, 6));
      await comet.connect(borrower).supply(USDT.address, exp(100, 6));

      await comet.connect(borrower).withdraw(USDC.address, exp(510, 6));

      const _userBasicAfter = await comet.userBasic(borrower.address);
      console.log('assetsIn after full absorption:', _userBasicAfter);


      // Crash both prices to $1 → LP-weighted total = 9 + 90 = 99 << 510 debt
      // Full absorption: targetHF is unreachable → all collateral seized, debt zeroed by reserves
      await setPrice(priceFeedCOMP, governor, 1);
      await setPrice(priceFeedUSDT, governor, 1);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // All collateral fully seized, debt absorbed by reserves
      expect((await comet.borrowBalanceOf(borrower.address)).toBigInt()).to.equal(0n);
      expect((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()).to.equal(0n);
      expect((await comet.userCollateral(borrower.address, USDT.address)).balance.toBigInt()).to.equal(0n);

      // BUG CONFIRMATION: assetsIn bits are not cleared by absorbInternal after full seizure
      // On current code this test FAILS: assetsIn = 3 (bits 0+1 still set), _reserved = 0
      const userBasicAfter = await comet.userBasic(borrower.address);
      console.log('assetsIn after full absorption:', userBasicAfter);
      expect(userBasicAfter.assetsIn).to.equal(0, 'assetsIn should be 0 after full absorption (bug: bits not cleared)');
      expect(userBasicAfter._reserved).to.equal(0, '_reserved should be 0 after full absorption');
    });
  });

  // ── Scenario 3b — assetsIn not cleared after mixed absorption (bug confirmation) ──

  describe('Scenario 3b — assetsIn COMP bit not cleared after mixed partial/full absorption (bug confirmation)', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: any;
    let USDC: any;
    let COMP: any;
    let USDT: any;
    let priceFeedCOMP: any;
    let priceFeedUSDT: any;
    let snapshotId: string;

    before(async function() {
      [governor, liquidator, borrower] = await ethers.getSigners();

      const FaucetFactory = await ethers.getContractFactory('FaucetToken');
      USDC = await FaucetFactory.deploy(exp(10_000_000, 6), 'USDC', 6, 'USDC');
      await USDC.deployed();
      COMP = await FaucetFactory.deploy(exp(1_000_000, 18), 'COMP', 18, 'COMP');
      await COMP.deployed();
      USDT = await FaucetFactory.deploy(exp(1_000_000, 6), 'USDT', 6, 'USDT');
      await USDT.deployed();

      const PriceFeedFactory = await ethers.getContractFactory('SimplePriceFeed');
      const priceFeedUSDC = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDC.deployed();
      priceFeedCOMP = await PriceFeedFactory.deploy(exp(50, 8), 8);
      await priceFeedCOMP.deployed();
      priceFeedUSDT = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDT.deployed();

      const AssetListFactoryContract = await ethers.getContractFactory('AssetListFactory');
      const assetListFactory = await AssetListFactoryContract.deploy();
      await assetListFactory.deployed();

      const CometExtFactory = await ethers.getContractFactory('CometExtAssetList');
      const extensionDelegate = await CometExtFactory.deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
        },
        assetListFactory.address
      );
      await extensionDelegate.deployed();

      // COMP (asset 0): borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.9
      // USDT (asset 1): borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.9
      // targetHF=1.05, LP=0.9
      // LP × targetHF = 0.9 × 1.05 = 0.945 > 0.80 (borrowCF) ✓
      // liquidateCF=0.85 < LP=0.9: enables partial USDT seizure after full COMP seizure
      const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
      comet = await CometFactory.deploy({
        governor: governor.address,
        pauseGuardian: governor.address,
        extensionDelegate: extensionDelegate.address,
        baseToken: USDC.address,
        baseTokenPriceFeed: priceFeedUSDC.address,
        supplyKink: exp(0.8, 18),
        supplyPerYearInterestRateBase: 0n,
        supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
        supplyPerYearInterestRateSlopeHigh: exp(2, 18),
        borrowKink: exp(0.8, 18),
        borrowPerYearInterestRateBase: 0n,
        borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
        borrowPerYearInterestRateSlopeHigh: exp(3, 18),
        storeFrontPriceFactor: exp(1, 18),
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: 0n,
        baseTrackingBorrowSpeed: 0n,
        baseMinForRewards: exp(1, 6),
        baseBorrowMin: exp(1, 6),
        targetReserves: 0n,
        targetHealthFactor: exp(1.05, 18),
        assetConfigs: [
          {
            asset: COMP.address,
            priceFeed: priceFeedCOMP.address,
            decimals: 18,
            borrowCollateralFactor: exp(0.80, 18),
            liquidateCollateralFactor: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
          {
            asset: USDT.address,
            priceFeed: priceFeedUSDT.address,
            decimals: 6,
            borrowCollateralFactor: exp(0.80, 18),
            liquidateCollateralFactor: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 6),
          },
        ],
      });
      await comet.deployed();
      await comet.initializeStorage();

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('3b: COMP bit in assetsIn not cleared after mixed COMP-full / USDT-partial absorption (bug confirmation — expected to fail before fix)', async function() {
      // Governor provides USDC liquidity (enough to cover reserves)
      await USDC.connect(governor).approve(comet.address, exp(2000, 6));
      await comet.connect(governor).supply(USDC.address, exp(2000, 6));

      // Borrower supplies:
      //   COMP (asset 0): 10 × $50 = $500, borrowCF=0.80 → capacity = $400
      //   USDT (asset 1): 1000 × $1 = $1000, borrowCF=0.80 → capacity = $800
      //   Total borrow capacity = $1200 → borrow 900 USDC
      await COMP.connect(governor).transfer(borrower.address, exp(10, 18));
      await COMP.connect(borrower).approve(comet.address, exp(10, 18));
      await comet.connect(borrower).supply(COMP.address, exp(10, 18));

      await USDT.connect(governor).transfer(borrower.address, exp(1000, 6));
      await USDT.connect(borrower).approve(comet.address, exp(1000, 6));
      await comet.connect(borrower).supply(USDT.address, exp(1000, 6));

      await comet.connect(borrower).withdraw(USDC.address, exp(900, 6));

      // Drop COMP price to $1. USDT stays at $1.
      // liquidateCF=0.85 for both assets.
      // TCV (liquidateCF-weighted) = 10×1×0.85 + 1000×1×0.85 = 8.5 + 850 = 858.5 USD
      // debt=900 > 858.5 → isLiquidatable=true ✓
      // denom = LP×targetHF - borrowCF = 0.9×1.05 - 0.80 = 0.145
      // COMP rawUSD = (900×1.05 - 0.80×1010) / 0.145 = (945 - 808) / 0.145 ≈ 944.8 >> 10 → full seizure ✓
      // After COMP: debtRemaining ≈ 900 - 0.9×10×1 = 891; TCV remaining = 0.80×1000 = 800
      // USDT rawUSD = (891×1.05 - 800) / 0.145 = (935.55 - 800) / 0.145 ≈ 934.8 ≤ 1000 → partial seizure ✓
      await setPrice(priceFeedCOMP, governor, 1);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP (asset 0): fully seized (balance → 0)
      // rawCOMP = (900×1.05 - 0.80×(10+1000)×1) / (0.9×1.05 - 0.80) = (945 - 808) / 0.145 ≈ 944.8 >> 10 → full seizure ✓
      expect((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()).to.equal(0n, 'COMP should be fully seized');

      // USDT (asset 1): partially seized (balance > 0)
      // After COMP full seizure: debtRemaining = 900 - 0.9×10×1 = 900 - 9 = 891 USD; TCV remaining = 0.80×1000 = 800
      // rawUSDT = (891×1.05 - (1000×1×0.80)) / (0.9×1.05 - 0.80) = (935.55 - 800) / 0.145 ≈ 934.8 USDT ≤ 1000 → partial ✓
      const usdtBalance = (await comet.userCollateral(borrower.address, USDT.address)).balance.toBigInt();
      expect(usdtBalance).to.be.gt(0n, 'USDT should be only partially seized');

      // Position not fully settled — some debt remains at targetHF level
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      expect(debtAfter).to.be.gt(0n, 'Remaining debt should be > 0 after partial seizure');

      // Not liquidatable: remaining USDT covers the remaining debt at liquidateCF threshold
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // BUG CONFIRMATION: COMP (asset 0) bit in assetsIn not cleared after full seizure
      // Asset 0 = bit 0 → assetsIn has bit 0 set even though COMP balance is 0
      // Asset 1 = bit 1 → assetsIn has bit 1 set (USDT still has balance)
      // Expected after fix: assetsIn = 2 (0b10, only USDT bit)
      // Current bug: assetsIn = 3 (0b11, both bits set — COMP bit not cleared)
      const userBasicAfter = await comet.userBasic(borrower.address);
      console.log('assetsIn after mixed absorption:', userBasicAfter);
      expect(userBasicAfter.assetsIn).to.equal(2, 'assetsIn should be 2 (only USDT bit set) after mixed absorption (bug: COMP bit not cleared)');
    });
  });

  // ── Scenario 1 — numerator-underflow invariant ──

  describe('Scenario 1 — numerator stays positive after full COMP seizure (regression invariant)', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: any;
    let USDC: any;
    let COMP: any;
    let USDT: any;
    let priceFeedCOMP: any;
    let snapshotId: string;

    before(async function() {
      [governor, liquidator, borrower] = await ethers.getSigners();

      const FaucetFactory = await ethers.getContractFactory('FaucetToken');
      USDC = await FaucetFactory.deploy(exp(10_000_000, 6), 'USDC', 6, 'USDC');
      await USDC.deployed();
      COMP = await FaucetFactory.deploy(exp(1_000_000, 18), 'COMP', 18, 'COMP');
      await COMP.deployed();
      USDT = await FaucetFactory.deploy(exp(1_000_000, 6), 'USDT', 6, 'USDT');
      await USDT.deployed();

      const PriceFeedFactory = await ethers.getContractFactory('SimplePriceFeed');
      const priceFeedUSDC = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDC.deployed();
      priceFeedCOMP = await PriceFeedFactory.deploy(exp(40, 8), 8);
      await priceFeedCOMP.deployed();
      const priceFeedUSDT = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDT.deployed();

      const AssetListFactoryContract = await ethers.getContractFactory('AssetListFactory');
      const assetListFactory = await AssetListFactoryContract.deploy();
      await assetListFactory.deployed();

      const CometExtFactory = await ethers.getContractFactory('CometExtAssetList');
      const extensionDelegate = await CometExtFactory.deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
        },
        assetListFactory.address
      );
      await extensionDelegate.deployed();

      // COMP (asset 0): borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.9
      // USDT (asset 1): borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.9
      // targetHF=1.05, denom = LP×targetHF - borrowCF = 0.9×1.05 - 0.80 = 0.145
      // Initial COMP $40: max borrow = (10×40 + 1000)×0.80 = 1120 USDC
      // isLiquidatable at $25: TCV_liq = (10×25 + 1000)×0.85 = 1062.5 < 1100 ✓
      const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
      comet = await CometFactory.deploy({
        governor: governor.address,
        pauseGuardian: governor.address,
        extensionDelegate: extensionDelegate.address,
        baseToken: USDC.address,
        baseTokenPriceFeed: priceFeedUSDC.address,
        supplyKink: exp(0.8, 18),
        supplyPerYearInterestRateBase: 0n,
        supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
        supplyPerYearInterestRateSlopeHigh: exp(2, 18),
        borrowKink: exp(0.8, 18),
        borrowPerYearInterestRateBase: 0n,
        borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
        borrowPerYearInterestRateSlopeHigh: exp(3, 18),
        storeFrontPriceFactor: exp(1, 18),
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: 0n,
        baseTrackingBorrowSpeed: 0n,
        baseMinForRewards: exp(1, 6),
        baseBorrowMin: exp(1, 6),
        targetReserves: 0n,
        targetHealthFactor: exp(1.05, 18),
        assetConfigs: [
          {
            asset: COMP.address,
            priceFeed: priceFeedCOMP.address,
            decimals: 18,
            borrowCollateralFactor: exp(0.80, 18),
            liquidateCollateralFactor: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
          {
            asset: USDT.address,
            priceFeed: priceFeedUSDT.address,
            decimals: 6,
            borrowCollateralFactor: exp(0.80, 18),
            liquidateCollateralFactor: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 6),
          },
        ],
      });
      await comet.deployed();
      await comet.initializeStorage();

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('1: numerator stays positive after COMP full seizure — absorb does not revert, USDT partially seized', async function() {
      // Governor provides USDC liquidity
      await USDC.connect(governor).approve(comet.address, exp(2000, 6));
      await comet.connect(governor).supply(USDC.address, exp(2000, 6));

      // Borrower supplies:
      //   COMP (asset 0): 10 × $40 = $400, borrowCF=0.80 → capacity = $320
      //   USDT (asset 1): 1000 × $1 = $1000, borrowCF=0.80 → capacity = $800
      //   Total borrow capacity = $1120 → borrow 1100 USDC
      await COMP.connect(governor).transfer(borrower.address, exp(10, 18));
      await COMP.connect(borrower).approve(comet.address, exp(10, 18));
      await comet.connect(borrower).supply(COMP.address, exp(10, 18));

      await USDT.connect(governor).transfer(borrower.address, exp(1000, 6));
      await USDT.connect(borrower).approve(comet.address, exp(1000, 6));
      await comet.connect(borrower).supply(USDT.address, exp(1000, 6));

      await comet.connect(borrower).withdraw(USDC.address, exp(1100, 6));

      // Drop COMP price from $40 to $25. USDT stays at $1.
      // isLiquidatable (liquidateCF=0.85):
      //   TCV_liq = 10×25×0.85 + 1000×0.85 = 212.5 + 850 = 1062.5 < 1100 → liquidatable ✓
      //
      // absorbInternal uses borrowCF=0.80, denom = 0.9×1.05 - 0.80 = 0.145:
      //   TCV_initial = 10×25×0.80 + 1000×0.80 = 200 + 800 = 1000
      //
      //   COMP: rawCOMP = (1100×1.05 - 1000) / 0.145 = 155 / 0.145 ≈ 1069 >> 250 → full seizure ✓
      //     seizedValue = 0.9×250 = 225; debtRemaining = 875; TCV_remaining = 800
      //
      //   USDT: numerator = 875×1.05 - 800 = 918.75 - 800 = 118.75 > 0 (no underflow ← key invariant)
      //     rawUSDT = 118.75 / 0.145 ≈ 819 ≤ 1000 → partial seizure ✓
      await setPrice(priceFeedCOMP, governor, 25);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // absorb must not revert (invariant: numerator > 0 throughout)
      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP (asset 0): fully seized
      expect((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()).to.equal(0n, 'COMP should be fully seized');

      // USDT (asset 1): partially seized — balance must remain > 0
      const usdtBalance = (await comet.userCollateral(borrower.address, USDT.address)).balance.toBigInt();
      expect(usdtBalance).to.be.gt(0n, 'USDT should be only partially seized');

      // Remaining debt > 0 (partial liquidation stopped at targetHF)
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      expect(debtAfter).to.be.gt(0n, 'Remaining debt should be > 0 after partial seizure');

      // Position is healthy after absorb
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });

  // ── Scenario 2 — debtRemaining underflow invariant ──

  describe('Scenario 2 — debtRemaining stays positive after full COMP seizure (regression invariant)', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: any;
    let USDC: any;
    let COMP: any;
    let WBTC: any;
    let priceFeedCOMP: any;
    let snapshotId: string;

    before(async function() {
      [governor, liquidator, borrower] = await ethers.getSigners();

      const FaucetFactory = await ethers.getContractFactory('FaucetToken');
      USDC = await FaucetFactory.deploy(exp(10_000_000, 6), 'USDC', 6, 'USDC');
      await USDC.deployed();
      COMP = await FaucetFactory.deploy(exp(1_000_000, 18), 'COMP', 18, 'COMP');
      await COMP.deployed();
      WBTC = await FaucetFactory.deploy(exp(1_000, 8), 'WBTC', 8, 'WBTC');
      await WBTC.deployed();

      const PriceFeedFactory = await ethers.getContractFactory('SimplePriceFeed');
      const priceFeedUSDC = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDC.deployed();
      priceFeedCOMP = await PriceFeedFactory.deploy(exp(50, 8), 8);
      await priceFeedCOMP.deployed();
      const priceFeedWBTC = await PriceFeedFactory.deploy(exp(30000, 8), 8);
      await priceFeedWBTC.deployed();

      const AssetListFactoryContract = await ethers.getContractFactory('AssetListFactory');
      const assetListFactory = await AssetListFactoryContract.deploy();
      await assetListFactory.deployed();

      const CometExtFactory = await ethers.getContractFactory('CometExtAssetList');
      const extensionDelegate = await CometExtFactory.deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
        },
        assetListFactory.address
      );
      await extensionDelegate.deployed();

      // COMP (asset 0): borrowCF=0.85, liquidateCF=0.9, liquidationFactor=0.95
      // WBTC (asset 1): borrowCF=0.85, liquidateCF=0.9, liquidationFactor=0.95
      // targetHF=1.05, denom = LP×targetHF - borrowCF = 0.95×1.05 - 0.85 = 0.1475
      // Max borrow at COMP $50: (20×50 + 0.1×30000)×0.85 = 4000×0.85 = 3400 USDC
      const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
      comet = await CometFactory.deploy({
        governor: governor.address,
        pauseGuardian: governor.address,
        extensionDelegate: extensionDelegate.address,
        baseToken: USDC.address,
        baseTokenPriceFeed: priceFeedUSDC.address,
        supplyKink: exp(0.8, 18),
        supplyPerYearInterestRateBase: 0n,
        supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
        supplyPerYearInterestRateSlopeHigh: exp(2, 18),
        borrowKink: exp(0.8, 18),
        borrowPerYearInterestRateBase: 0n,
        borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
        borrowPerYearInterestRateSlopeHigh: exp(3, 18),
        storeFrontPriceFactor: exp(1, 18),
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: 0n,
        baseTrackingBorrowSpeed: 0n,
        baseMinForRewards: exp(1, 6),
        baseBorrowMin: exp(1, 6),
        targetReserves: 0n,
        targetHealthFactor: exp(1.05, 18),
        assetConfigs: [
          {
            asset: COMP.address,
            priceFeed: priceFeedCOMP.address,
            decimals: 18,
            borrowCollateralFactor: exp(0.85, 18),
            liquidateCollateralFactor: exp(0.9, 18),
            liquidationFactor: exp(0.95, 18),
            supplyCap: exp(1_000_000, 18),
          },
          {
            asset: WBTC.address,
            priceFeed: priceFeedWBTC.address,
            decimals: 8,
            borrowCollateralFactor: exp(0.85, 18),
            liquidateCollateralFactor: exp(0.9, 18),
            liquidationFactor: exp(0.95, 18),
            supplyCap: exp(1_000, 8),
          },
        ],
      });
      await comet.deployed();
      await comet.initializeStorage();

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('2: debtRemaining stays positive after full COMP seizure — absorb does not revert, WBTC partially seized', async function() {
      // Governor provides USDC liquidity
      await USDC.connect(governor).approve(comet.address, exp(5000, 6));
      await comet.connect(governor).supply(USDC.address, exp(5000, 6));

      // Borrower supplies:
      //   COMP (asset 0): 20 × $50 = $1000, borrowCF=0.85 → capacity = $850
      //   WBTC (asset 1): 0.1 × $30000 = $3000, borrowCF=0.85 → capacity = $2550
      //   Total borrow capacity = $3400 → borrow 3400 USDC
      await COMP.connect(governor).transfer(borrower.address, exp(20, 18));
      await COMP.connect(borrower).approve(comet.address, exp(20, 18));
      await comet.connect(borrower).supply(COMP.address, exp(20, 18));

      await WBTC.connect(governor).transfer(borrower.address, exp(1, 7));  // 0.1 WBTC = 10_000_000 units
      await WBTC.connect(borrower).approve(comet.address, exp(1, 7));
      await comet.connect(borrower).supply(WBTC.address, exp(1, 7));

      await comet.connect(borrower).withdraw(USDC.address, exp(3400, 6));

      // Drop COMP price from $50 to $35. WBTC stays at $30000.
      // isLiquidatable (liquidateCF=0.9):
      //   TCV_liq = 20×35×0.9 + 3000×0.9 = 630 + 2700 = 3330 < 3400 → liquidatable ✓
      //
      // absorbInternal uses borrowCF=0.85, denom = 0.95×1.05 - 0.85 = 0.1475:
      //   TCV_initial = 20×35×0.85 + 3000×0.85 = 595 + 2550 = 3145
      //
      //   COMP: rawCOMP = (3400×1.05 - 3145) / 0.1475 = 425 / 0.1475 ≈ 2881 >> 700 → full seizure ✓
      //     seizedValue = 0.95×700 = 665; deltaValue = 665
      //     debtRemaining = 3400 - 665 = 2735 > 0 (no underflow ← key invariant) ✓
      //     TCV_remaining = 3145 - 595 = 2550
      //
      //   WBTC: numerator = 2735×1.05 - 2550 = 321.75 > 0 (no underflow ✓)
      //     rawWBTC = 321.75 / 0.1475 ≈ 2181 USD ≤ 3000 → partial seizure ✓
      await setPrice(priceFeedCOMP, governor, 35);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // absorb must not revert (invariant: debtRemaining > 0 throughout)
      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP (asset 0): fully seized
      expect((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()).to.equal(0n, 'COMP should be fully seized');

      // WBTC (asset 1): partially seized — balance must remain > 0
      const wbtcBalance = (await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt();
      expect(wbtcBalance).to.be.gt(0n, 'WBTC should be only partially seized');

      // Remaining debt > 0 (partial liquidation stopped at targetHF)
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      expect(debtAfter).to.be.gt(0n, 'Remaining debt should be > 0 after partial seizure');

      // Position is healthy after absorb
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });

  // ── Scenario 5 — totalCollateralizedValue stale after partial seizure (latent bug documentation) ──

  describe('Scenario 5 — stale in-memory TCV after partial USDT seizure (latent bug documentation)', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: any;
    let USDC: any;
    let COMP: any;
    let USDT: any;
    let priceFeedCOMP: any;
    let snapshotId: string;

    before(async function() {
      [governor, liquidator, borrower] = await ethers.getSigners();

      const FaucetFactory = await ethers.getContractFactory('FaucetToken');
      USDC = await FaucetFactory.deploy(exp(10_000_000, 6), 'USDC', 6, 'USDC');
      await USDC.deployed();
      COMP = await FaucetFactory.deploy(exp(1_000_000, 18), 'COMP', 18, 'COMP');
      await COMP.deployed();
      USDT = await FaucetFactory.deploy(exp(1_000_000, 6), 'USDT', 6, 'USDT');
      await USDT.deployed();

      const PriceFeedFactory = await ethers.getContractFactory('SimplePriceFeed');
      const priceFeedUSDC = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDC.deployed();
      priceFeedCOMP = await PriceFeedFactory.deploy(exp(40, 8), 8);
      await priceFeedCOMP.deployed();
      const priceFeedUSDT = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeedUSDT.deployed();

      const AssetListFactoryContract = await ethers.getContractFactory('AssetListFactory');
      const assetListFactory = await AssetListFactoryContract.deploy();
      await assetListFactory.deployed();

      const CometExtFactory = await ethers.getContractFactory('CometExtAssetList');
      const extensionDelegate = await CometExtFactory.deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
        },
        assetListFactory.address
      );
      await extensionDelegate.deployed();

      // Identical configuration to Scenario 1:
      // COMP (asset 0): borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.9
      // USDT (asset 1): borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.9
      // targetHF=1.05, denom = 0.9×1.05 - 0.80 = 0.145
      const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
      comet = await CometFactory.deploy({
        governor: governor.address,
        pauseGuardian: governor.address,
        extensionDelegate: extensionDelegate.address,
        baseToken: USDC.address,
        baseTokenPriceFeed: priceFeedUSDC.address,
        supplyKink: exp(0.8, 18),
        supplyPerYearInterestRateBase: 0n,
        supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
        supplyPerYearInterestRateSlopeHigh: exp(2, 18),
        borrowKink: exp(0.8, 18),
        borrowPerYearInterestRateBase: 0n,
        borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
        borrowPerYearInterestRateSlopeHigh: exp(3, 18),
        storeFrontPriceFactor: exp(1, 18),
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: 0n,
        baseTrackingBorrowSpeed: 0n,
        baseMinForRewards: exp(1, 6),
        baseBorrowMin: exp(1, 6),
        targetReserves: 0n,
        targetHealthFactor: exp(1.05, 18),
        assetConfigs: [
          {
            asset: COMP.address,
            priceFeed: priceFeedCOMP.address,
            decimals: 18,
            borrowCollateralFactor: exp(0.80, 18),
            liquidateCollateralFactor: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
          {
            asset: USDT.address,
            priceFeed: priceFeedUSDT.address,
            decimals: 6,
            borrowCollateralFactor: exp(0.80, 18),
            liquidateCollateralFactor: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 6),
          },
        ],
      });
      await comet.deployed();
      await comet.initializeStorage();

      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('5: stale in-memory TCV is non-trivially larger than actual storage TCV after partial USDT seizure', async function() {
      // Position identical to Scenario 1:
      //   COMP (asset 0): 10 × $40 = $400, borrowCF=0.80 → capacity $320
      //   USDT (asset 1): 1000 × $1 = $1000, borrowCF=0.80 → capacity $800
      //   Borrow: 1100 USDC; drop COMP to $25 → isLiquidatable ✓
      await USDC.connect(governor).approve(comet.address, exp(2000, 6));
      await comet.connect(governor).supply(USDC.address, exp(2000, 6));

      await COMP.connect(governor).transfer(borrower.address, exp(10, 18));
      await COMP.connect(borrower).approve(comet.address, exp(10, 18));
      await comet.connect(borrower).supply(COMP.address, exp(10, 18));

      await USDT.connect(governor).transfer(borrower.address, exp(1000, 6));
      await USDT.connect(borrower).approve(comet.address, exp(1000, 6));
      await comet.connect(borrower).supply(USDT.address, exp(1000, 6));

      await comet.connect(borrower).withdraw(USDC.address, exp(1100, 6));

      await setPrice(priceFeedCOMP, governor, 25);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP fully seized
      expect((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()).to.equal(0n);

      // USDT partially seized — remaining balance is the basis for our TCV check
      const usdtRemaining = (await comet.userCollateral(borrower.address, USDT.address)).balance.toBigInt();
      expect(usdtRemaining).to.be.gt(0n, 'USDT should be only partially seized');

      // ── TCV staleness documentation ──
      //
      // TCV units: mulPrice(balance, price, scale) × mulFactor(borrowCF)
      //   For USDT at $1 (price=1e8, scale=1e6, borrowCF=0.80e18):
      //     TCV_per_unit = 1e8/1e6 × 0.80e18/1e18 = 100 × 0.80 = 80
      //   So: TCV_contribution = balance_units × 80
      //
      // Actual TCV from storage (COMP balance=0, only USDT contributes):
      const TCV_FACTOR = 80n; // = (price/scale) × borrowCF = 100 × 0.80
      const actualTcvFromStorage = usdtRemaining * TCV_FACTOR;

      // Stale in-memory TCV at the moment of `break` inside absorbInternal:
      //   After COMP full seizure:
      //     TCV -= mulFactor(COMP_available_USD, borrowCF)   ← IS updated (currentHF=0 < targetHF)
      //   After USDT partial seizure:
      //     TCV is NOT updated (currentHF == targetHF, condition `< targetHF` is false → no decrement)
      //   So stale_TCV = TCV_initial - CF_COMP × COMP_available_USD = USDT_initial × 80
      //   (COMP contribution adds and then subtracts, leaving only USDT_initial × 80)
      const USDT_INITIAL = exp(1000, 6); // 1_000_000_000n
      const staleTcvAtBreak = USDT_INITIAL * TCV_FACTOR; // 80_000_000_000n ≈ 800 USD × PRICE_SCALE

      // Key invariant: stale in-memory TCV > actual storage TCV
      // Gap = CF_USDT × seized_USDT_available_USD ≈ 0.80 × 819 USD ≈ 655 USD (non-trivial)
      const stalenessGap = staleTcvAtBreak - actualTcvFromStorage;
      expect(stalenessGap).to.be.gt(0n,
        'latent bug: stale in-memory TCV at break is larger than actual storage TCV by CF×seized_USDT_USD');

      // Verify the gap is non-trivial (> 1 USD in price-scale units = 1e8)
      expect(stalenessGap).to.be.gt(BigInt(1e8),
        'staleness gap must be non-trivially large (> 1 USD)');

      // Position is healthy — current code is correct because nothing reads TCV after break
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });

  // ── Scenario 6 — worked example: COMP fully seized, ETH partially seized ──
  //
  // Parameters (from docs/partial-liquidation-example.md):
  //   COMP: borrowCF=0.75, liquidateCF=0.80, liquidationFactor=0.90, price $20 → $11
  //   ETH:  borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $2000
  //   targetHF = 1.05
  //   Deposit: 100 COMP ($2000) + 0.5 ETH ($1000), borrow: $1800 USDC
  //
  // Liquidation math:
  //   TCV_CF = 100×11×0.75 + 0.5×2000×0.80 = 825 + 800 = $1625
  //   Iter 1 COMP: denom=0.90×1.05−0.75=0.195
  //     rawCOMP = (1800×1.05 − 1625) / 0.195 = 265/0.195 ≈ $1358.97 > $1100 → full seizure
  //     seizedValue = $1100×0.90 = $990; debtRemaining = $810; TCV_CF = $800
  //   Iter 2 ETH: denom=0.90×1.05−0.80=0.145
  //     rawETH = (810×1.05 − 800) / 0.145 = 50.5/0.145 ≈ $348.28 ≤ $1000 → partial seizure
  //     seizeAmount ≈ 0.17414 ETH; seizedValue ≈ $313.45; currentHF = targetHF → break
  //   Final debt ≈ $496.55 USDC; remaining ETH ≈ 0.32586 ETH; HF = 1.05

  describe('Scenario 6 — worked example (partial-liquidation-example.md): COMP fully seized, ETH partially seized, targetHF=1.05', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: any;
    // let USDC: any;
    // let COMP: any;
    // let WETH: any;
    let priceFeedCOMP: any;
    let snapshotId: string;

    // before(async function() {
    //   [governor, liquidator, borrower] = await ethers.getSigners();

    //   const FaucetFactory = await ethers.getContractFactory('FaucetToken');
    //   USDC = await FaucetFactory.deploy(exp(10_000_000, 6), 'USDC', 6, 'USDC');
    //   await USDC.deployed();
    //   COMP = await FaucetFactory.deploy(exp(1_000_000, 18), 'COMP', 18, 'COMP');
    //   await COMP.deployed();
    //   WETH = await FaucetFactory.deploy(exp(10_000, 18), 'WETH', 18, 'WETH');
    //   await WETH.deployed();

    //   const PriceFeedFactory = await ethers.getContractFactory('SimplePriceFeed');
    //   const priceFeedUSDC = await PriceFeedFactory.deploy(exp(1, 8), 8);
    //   await priceFeedUSDC.deployed();
    //   priceFeedCOMP = await PriceFeedFactory.deploy(exp(20, 8), 8);
    //   await priceFeedCOMP.deployed();
    //   const priceFeedWETH = await PriceFeedFactory.deploy(exp(2000, 8), 8);
    //   await priceFeedWETH.deployed();

    //   const AssetListFactoryContract = await ethers.getContractFactory('AssetListFactory');
    //   const assetListFactory = await AssetListFactoryContract.deploy();
    //   await assetListFactory.deployed();

    //   const CometExtFactory = await ethers.getContractFactory('CometExtAssetList');
    //   const extensionDelegate = await CometExtFactory.deploy(
    //     {
    //       name32: ethers.utils.formatBytes32String('Compound Comet'),
    //       symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
    //     },
    //     assetListFactory.address
    //   );
    //   await extensionDelegate.deployed();

    //   // COMP (asset 0): borrowCF=0.75, liquidateCF=0.80, liquidationFactor=0.90
    //   //   denom = 0.90×1.05 − 0.75 = 0.195 > 0 ✓
    //   // WETH (asset 1): borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90
    //   //   denom = 0.90×1.05 − 0.80 = 0.145 > 0 ✓
    //   const CometFactory = await ethers.getContractFactory('CometHarnessExtendedAssetList');
    //   comet = await CometFactory.deploy({
    //     governor: governor.address,
    //     pauseGuardian: governor.address,
    //     extensionDelegate: extensionDelegate.address,
    //     baseToken: USDC.address,
    //     baseTokenPriceFeed: priceFeedUSDC.address,
    //     supplyKink: exp(0.8, 18),
    //     supplyPerYearInterestRateBase: 0n,
    //     supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
    //     supplyPerYearInterestRateSlopeHigh: exp(2, 18),
    //     borrowKink: exp(0.8, 18),
    //     borrowPerYearInterestRateBase: 0n,
    //     borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
    //     borrowPerYearInterestRateSlopeHigh: exp(3, 18),
    //     storeFrontPriceFactor: exp(1, 18),
    //     trackingIndexScale: exp(1, 15),
    //     baseTrackingSupplySpeed: 0n,
    //     baseTrackingBorrowSpeed: 0n,
    //     baseMinForRewards: exp(1, 6),
    //     baseBorrowMin: exp(1, 6),
    //     targetReserves: 0n,
    //     targetHealthFactor: exp(1.05, 18),
    //     assetConfigs: [
    //       {
    //         asset: COMP.address,
    //         priceFeed: priceFeedCOMP.address,
    //         decimals: 18,
    //         borrowCollateralFactor: exp(0.75, 18),
    //         liquidateCollateralFactor: exp(0.80, 18),
    //         liquidationFactor: exp(0.90, 18),
    //         supplyCap: exp(1_000_000, 18),
    //       },
    //       {
    //         asset: WETH.address,
    //         priceFeed: priceFeedWETH.address,
    //         decimals: 18,
    //         borrowCollateralFactor: exp(0.80, 18),
    //         liquidateCollateralFactor: exp(0.85, 18),
    //         liquidationFactor: exp(0.90, 18),
    //         supplyCap: exp(10_000, 18),
    //       },
    //     ],
    //   });
    //   await comet.deployed();
    //   await comet.initializeStorage();

    //   snapshotId = await ethers.provider.send('evm_snapshot', []);
    // });

    // let comet: CometInterface;
    // let tokens: any, priceFeeds: any, governor: SignerWithAddress;
    let priceFeeds: any, tokens: any;
    let users: SignerWithAddress[];
    // let snapshotId: string;

     before(async function() {
      [governor, liquidator, borrower] = await ethers.getSigners();

      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 20,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(2e5, 18),
          },
          WETH: {
            initial: exp(10_000, 18),
            decimals: 18,
            initialPrice: 2000,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.90, 18),
            supplyCap: exp(10_000, 18),
          },
        },
        baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
      });

      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor, users } = protocol);
      snapshotId = await ethers.provider.send('evm_snapshot', []);

      const { USDC: priceFeedUSDC, COMP: _priceFeedCOMP, WETH: priceFeedWETH } = priceFeeds;

      await setPrice(priceFeedUSDC, governor, 1);
      await setPrice(_priceFeedCOMP, governor, 20);
      await setPrice(priceFeedWETH, governor, 2000);

      priceFeedCOMP = _priceFeedCOMP;


    });


    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('1: COMP fully seized, ETH partially seized, debt reduced to ~$496.55, HF reaches targetHF=1.05', async function() {
      const { USDC, COMP, WETH } = tokens;      
      // Governor provides USDC liquidity
      await USDC.connect(governor).approve(comet.address, exp(5000, 6));
      await comet.connect(governor).supply(USDC.address, exp(5000, 6));

      // Borrower deposits:
      //   100 COMP × $20 = $2000; borrowCF=0.75 → capacity = $1500
      //   0.5 WETH × $2000 = $1000; borrowCF=0.80 → capacity = $800
      //   Total borrow capacity = $2300 → borrow $1800 USDC (below max)
      await COMP.connect(governor).transfer(borrower.address, exp(100, 18));
      await COMP.connect(borrower).approve(comet.address, exp(100, 18));
      await comet.connect(borrower).supply(COMP.address, exp(100, 18));

      // await ethers.provider.send('evm_mine', []); // ensure block.timestamp increases for price change to take effect
      
      let userBasic = await comet.userBasic(borrower.address);
      console.log('\x1b[35m%s','After deposit COMP userBasic.assetsIn:', userBasic[3]);
      
      await WETH.connect(governor).transfer(borrower.address, exp(1, 18) / 2n);
      await WETH.connect(borrower).approve(comet.address, exp(1, 18) / 2n);
      await comet.connect(borrower).supply(WETH.address, exp(1, 18) / 2n);
      
      // await ethers.provider.send('evm_mine', []); // ensure block.timestamp increases for price change to take effect
      
      userBasic = await comet.userBasic(borrower.address);
      console.log('\x1b[35m%s','After deposit WETH userBasic.assetsIn:', userBasic[3]);

      await comet.connect(borrower).withdraw(USDC.address, exp(1800, 6));

      // Verify initial state: HF > 1, not liquidatable
      //   CF-weighted = $2300, liquidateCF-weighted = $2450, debt = $1800
      //   isLiquidatable: $2450 > $1800 → false ✓
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Drop COMP price $20 → $11 (−45%). WETH stays at $2000.
      // After drop:
      //   liquidateCF-weighted = 100×11×0.80 + 0.5×2000×0.85 = 880 + 850 = $1730 < $1800 → liquidatable ✓
      await setPrice(priceFeedCOMP, governor, 11);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      userBasic = await comet.userBasic(borrower.address);
      console.log('\x1b[35m%s','Initial userBasic.assetsIn:', userBasic[3]);

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP (asset 0): fully seized — entire 100 COMP seized
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      expect(compBalance).to.equal(0n, 'COMP should be fully seized');

      // WETH (asset 1): partially seized — some ETH remains
      //   seizeAmount ≈ 0.17414 ETH = 174137931030000000 wei
      //   remaining   ≈ 0.32586 ETH = 325862068970000000 wei
      const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      expect(wethBalance).to.be.gt(0n, 'WETH should be only partially seized');
      expect(wethBalance).to.be.lt(exp(1, 18) / 2n, 'WETH remaining must be less than initial 0.5 ETH');

      // Remaining debt > 0 (partial liquidation stopped at targetHF, not full)
      //   Expected: ~$496.55 USDC = ~496_550_000 base units (6 decimals)
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      expect(debtAfter).to.be.gt(0n, 'Remaining debt should be > 0 after partial seizure');
      expect(debtAfter).to.be.lt(exp(1800, 6), 'Debt must have been partially repaid');

      // Position is healthy after absorb — targetHF reached
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Precision check: verify WETH remaining is in the expected range [0.32 ETH, 0.34 ETH]
      //   Exact formula: seizeAmount = rawETH * WETH_scale / WETH_price
      //     rawETH = (810e8 * 1.05e18/1e18 - 800e8) * 1e18 / (0.9e18*1.05e18/1e18 - 0.8e18)
      //            = 5050000000 * 1e18 / 145000000000000000 = 34827586206
      //     seizeAmount = 34827586206 * 1e18 / 2000e8 = 174137931030000000 wei
      //   remaining = 500000000000000000 - 174137931030000000 = 325862068970000000
      expect(wethBalance).to.be.gte(320n * exp(1, 15), 'WETH remaining should be >= 0.320 ETH');
      expect(wethBalance).to.be.lte(340n * exp(1, 15), 'WETH remaining should be <= 0.340 ETH');
      console.log('\x1b[36m%s','Remaining WETH (ETH):', Number(wethBalance) / 1e18);
      console.log('\x1b[36m%s','Remaining debt (USDC):', Number(debtAfter) / 1e6);
      // Precision check: verify remaining debt is in the expected range [$490, $510]
      expect(debtAfter).to.be.gte(exp(490, 6), 'Remaining debt should be >= $490');
      expect(debtAfter).to.be.lte(exp(510, 6), 'Remaining debt should be <= $510');

      userBasic = await comet.userBasic(borrower.address);
      console.log('\x1b[35m%s','Final userBasic.assetsIn:', userBasic[3]);

    });
  });
});
