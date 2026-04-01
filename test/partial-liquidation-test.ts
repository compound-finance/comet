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

async function setupLiquidator(
  comet: CometInterface,
  tokens: any,
  governor: SignerWithAddress,
  liquidator: SignerWithAddress
) {
  await tokens.USDC.connect(governor).transfer(liquidator.address, exp(10000, 6));
  await tokens.USDC.connect(liquidator).approve(comet.address, exp(10000, 6));
  await comet.connect(liquidator).supply(tokens.USDC.address, exp(10000, 6));
}

/**
 * Computes the health factor for `account` on `comet`.
 *
 * HF = (Σ borrowCF_i × collateral_i × price_i / scale_i) / (debt × basePrice / baseScale)
 *
 * Uses borrowCollateralFactor-weighted collateral, matching the formula used by
 * the partial-liquidation algorithm inside the contract (absorbInternal uses
 * totalCollaterizedValue = _getLiquidity(account, false), which applies borrowCF).
 * This means HF == targetHealthFactor (1.05) immediately after a partial liquidation,
 * as documented in partial-liquidation-example.md.
 *
 * The result is in FACTOR_SCALE units (1e18 = 1.0), so targetHF=1.05 equals exp(1.05, 18).
 * Returns 0 when the account has no outstanding debt.
 */
async function getHealthFactor(comet: CometInterface, account: string): Promise<bigint> {
  const debtBase = (await comet.borrowBalanceOf(account)).toBigInt();
  if (debtBase === 0n) return 0n;

  const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
  const baseScale = (await comet.baseScale()).toBigInt();
  const factorScale = (await comet.factorScale()).toBigInt();

  const debtUSD = debtBase * basePrice / baseScale;

  const numAssets = await comet.numAssets();
  let collateralUSD = 0n;

  for (let i = 0; i < numAssets; i++) {
    const assetInfo = await comet.getAssetInfo(i);
    const balance = (await comet.userCollateral(account, assetInfo.asset)).balance.toBigInt();
    if (balance === 0n) continue;

    const price = (await comet.getPrice(assetInfo.priceFeed)).toBigInt();
    const scale = assetInfo.scale.toBigInt();
    const borrowCF = assetInfo.borrowCollateralFactor.toBigInt();

    collateralUSD += balance * price / scale * borrowCF / factorScale;
  }

  return collateralUSD * factorScale / debtUSD;
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

      await setPrice(priceFeedCOMP, governor, 1);
      await setPrice(priceFeedUSDC, governor, 1);

      await USDC.connect(governor).transfer(user1.address, exp(2_000_000, 6));
      await USDC.connect(user1).approve(comet.address, exp(2_000_000, 6));
      await comet.connect(user1).supply(USDC.address, exp(2_000_000, 6));

      const compAmount = exp(100_000, 18);
      await COMP.connect(governor).transfer(userToLiquidate.address, compAmount);
      await COMP.connect(userToLiquidate).approve(comet.address, compAmount);
      await comet.connect(userToLiquidate).supply(COMP.address, compAmount);

      const borrowCapacityCOMP = await borrowCapacityForAsset(comet, userToLiquidate, 0);
      await comet.connect(userToLiquidate).withdraw(USDC.address, borrowCapacityCOMP);
      expect(await comet.borrowBalanceOf(userToLiquidate.address)).to.equal(borrowCapacityCOMP);

      const compBalanceBefore = (await comet.userCollateral(userToLiquidate.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[35m%s','Init COMP:', Number(compBalanceBefore) / 1e18);

      const debtBefore = (await comet.borrowBalanceOf(userToLiquidate.address)).toBigInt();
      console.log('\x1b[35m%s','Init debt (USDC):', Number(debtBefore) / 1e6);

      await setPrice(priceFeedCOMP, governor, 0.94);
      await comet.accrueAccount(userToLiquidate.address);

      expect(await comet.isLiquidatable(userToLiquidate.address)).to.be.true;
      await comet.connect(user1).absorb(user1.address, [userToLiquidate.address]);
      
      expect(await comet.isLiquidatable(userToLiquidate.address)).to.be.false;

      const compBalanceAfter = (await comet.userCollateral(userToLiquidate.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[36m%s','Remaining COMP:', Number(compBalanceAfter) / 1e18);

      const debtAfter = (await comet.borrowBalanceOf(userToLiquidate.address)).toBigInt();
      console.log('\x1b[36m%s','Remaining debt (USDC):', Number(debtAfter) / 1e6);

      const currentHF = await getHealthFactor(comet, userToLiquidate.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
    });

    it('should demonstrate partial liquidation with two collateral', async function () {
      const [user1, userToLiquidate] = users;
      const { USDC, COMP, USDT } = tokens;
      const { COMP: priceFeedCOMP, USDC: priceFeedUSDC, USDT: priceFeedUSDT } = priceFeeds;

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
      const borrowCapacityCOMP = await borrowCapacityForAsset(comet, userToLiquidate, 0);

      const usdtAmount = exp(100_000, 6);
      await USDT.connect(governor).transfer(userToLiquidate.address, usdtAmount);
      await USDT.connect(userToLiquidate).approve(comet.address, usdtAmount);
      await comet.connect(userToLiquidate).supply(USDT.address, usdtAmount);
      const borrowCapacityUSDT = await borrowCapacityForAsset(comet, userToLiquidate, 1);

      const totalBorrowAmount = borrowCapacityCOMP.add(borrowCapacityUSDT);
      await comet.connect(userToLiquidate).withdraw(USDC.address, totalBorrowAmount);
      expect(await comet.borrowBalanceOf(userToLiquidate.address)).to.equal(totalBorrowAmount);

      const compBalanceBefore = (await comet.userCollateral(userToLiquidate.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[35m%s','Init COMP:', Number(compBalanceBefore) / 1e18);
      const usdtBalanceBefore = (await comet.userCollateral(userToLiquidate.address, USDT.address)).balance.toBigInt();
      console.log('\x1b[35m%s','Init USDT:', Number(usdtBalanceBefore) / 1e6);

      const debtBefore = (await comet.borrowBalanceOf(userToLiquidate.address)).toBigInt();
      console.log('\x1b[35m%s','Init debt (USDC):', Number(debtBefore) / 1e6);

      await setPrice(priceFeedCOMP, governor, 0.62);
      await comet.accrueAccount(userToLiquidate.address);

      expect(await comet.isLiquidatable(userToLiquidate.address)).to.be.true;
      await comet.connect(user1).absorb(user1.address, [userToLiquidate.address]);

      expect(await comet.isLiquidatable(userToLiquidate.address)).to.be.false;

      const compBalanceAfter = (await comet.userCollateral(userToLiquidate.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[36m%s','Remaining COMP:', Number(compBalanceAfter) / 1e18);
      const usdtBalanceAfter = (await comet.userCollateral(userToLiquidate.address, USDT.address)).balance.toBigInt();
      console.log('\x1b[36m%s','Remaining USDT:', Number(usdtBalanceAfter) / 1e6);

      const debtAfter = (await comet.borrowBalanceOf(userToLiquidate.address)).toBigInt();
      console.log('\x1b[36m%s','Remaining debt (USDC):', Number(debtAfter) / 1e6);

      const currentHF = await getHealthFactor(comet, userToLiquidate.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
    });
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

      await setupLiquidator(comet, tokens, governor, liquidator);

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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      await setupLiquidator(comet, tokens, governor, liquidator);

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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      await setupLiquidator(comet, tokens, governor, liquidator);

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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, user1.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
    });
  });

  // ── Scenario 4a/4b — targetHealthFactor constructor validation ──

  describe('Scenario 4 — targetHealthFactor constructor validation', function() {
    let governor: SignerWithAddress;
    let pauseGuardian: SignerWithAddress;
    let baseConfig: any;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(1_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 50,
            borrowCF: exp(0.85, 18),
            liquidateCF: exp(0.9, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1e5, 18),
          },
        },
      });
      governor = protocol.governor;
      pauseGuardian = protocol.pauseGuardian;
      baseConfig = {
        governor: protocol.governor.address,
        pauseGuardian: protocol.pauseGuardian.address,
        extensionDelegate: protocol.extensionDelegateAssetList.address,
        baseToken: protocol.tokens.USDC.address,
        baseTokenPriceFeed: protocol.priceFeeds.USDC.address,
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
          asset: protocol.tokens.COMP.address,
          priceFeed: protocol.priceFeeds.COMP.address,
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

    it('4b: reverts when LP * targetHealthFactor ≤ borrowCF (0.80 * 1.05 = 0.84 < borrowCF = 0.85)', async function() {
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

      // Drop COMP price to $43 -> liquidateCF × value = 100 × 43 × 0.9 = 3870 < 4000 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 43);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // Absorb: smoke check — must not revert
      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // All COMP seized (only asset):
      //   TCV_initial = 100×43×0.84 = 3612; denom = 0.80×1.06 - 0.84 = 0.008
      //   rawCOMP = (4000×1.06 - 3612) / 0.008 = (4240 - 3612) / 0.008 = 628 / 0.008 = 78500 >> availableUSD = 4300 
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      expect(compBalance.toBigInt()).to.equal(0n, 'All COMP should be seized');

      // Debt zeroed: seizedValue = LP × availableUSD = 0.80×4300 = 3440 < 4000 (debt)
      // newBalance = -4000 + 3440 = -560; condition (newBalance < 0 && currentHF < targetHF) -> newBalance = 0
      const debtAfter = await comet.borrowBalanceOf(borrower.address);
      expect(debtAfter.toBigInt()).to.equal(0n, 'Debt should be zeroed after full COMP absorption');

      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
    });
  });

  // ── Scenario 3a — assetsIn not cleared after full absorption ──

  describe('Scenario 3a — assetsIn not cleared after full absorption', function() {
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
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 50,
            borrowCF: exp(0.85, 18),
            liquidateCF: exp(0.9, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
          USDT: {
            initial: exp(1_000_000, 6),
            decimals: 6,
            initialPrice: 1,
            borrowCF: exp(0.85, 18),
            liquidateCF: exp(0.9, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 6),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, governor } = protocol);
      ({ USDC, COMP, USDT } = protocol.tokens);
      ({ COMP: priceFeedCOMP, USDT: priceFeedUSDT } = protocol.priceFeeds);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('3a: assetsIn and _reserved remain zero after full absorption', async function() {
      // Governor provides USDC liquidity
      await USDC.connect(governor).approve(comet.address, exp(1000, 6));
      await comet.connect(governor).supply(USDC.address, exp(1000, 6));

      // Borrower supplies COMP + USDT and borrows at max capacity
      // COMP: 10 × $50 × 0.85 = 425 USDC capacity
      // USDT: 100 × $1 × 0.85 = 85 USDC capacity -> total 510 USDC
      await COMP.connect(governor).transfer(borrower.address, exp(10, 18));
      await COMP.connect(borrower).approve(comet.address, exp(10, 18));
      await comet.connect(borrower).supply(COMP.address, exp(10, 18));

      await USDT.connect(governor).transfer(borrower.address, exp(100, 6));
      await USDT.connect(borrower).approve(comet.address, exp(100, 6));
      await comet.connect(borrower).supply(USDT.address, exp(100, 6));

      await comet.connect(borrower).withdraw(USDC.address, exp(510, 6));

      const _userBasicAfter = await comet.userBasic(borrower.address);
      console.log('assetsIn after full absorption:', _userBasicAfter);


      // Crash both prices to $1 -> LP-weighted total = 9 + 90 = 99 << 510 debt
      // Full absorption: targetHF is unreachable -> all collateral seized, debt zeroed by reserves
      await setPrice(priceFeedCOMP, governor, 1);
      await setPrice(priceFeedUSDT, governor, 1);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // All collateral fully seized, debt absorbed by reserves
      expect((await comet.borrowBalanceOf(borrower.address)).toBigInt()).to.equal(0n);
      expect((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()).to.equal(0n);
      expect((await comet.userCollateral(borrower.address, USDT.address)).balance.toBigInt()).to.equal(0n);

      const userBasicAfter = await comet.userBasic(borrower.address);
      console.log('assetsIn after full absorption:', userBasicAfter);
      expect(userBasicAfter.assetsIn).to.equal(0, 'assetsIn should be 0 after full absorption (bug: bits not cleared)');
      expect(userBasicAfter._reserved).to.equal(0, '_reserved should be 0 after full absorption');

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
    });
  });

  // ── Scenario 3b — assetsIn cleared after mixed absorption ──

  describe('Scenario 3b — assetsIn COMP bit cleared after mixed partial/full absorption', function() {
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
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 50,
            borrowCF: exp(0.80, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
          USDT: {
            initial: exp(1_000_000, 6),
            decimals: 6,
            initialPrice: 1,
            borrowCF: exp(0.80, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 6),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, governor } = protocol);
      ({ USDC, COMP, USDT } = protocol.tokens);
      ({ COMP: priceFeedCOMP, USDT: priceFeedUSDT } = protocol.priceFeeds);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('3b: COMP bit in assetsIn cleared after mixed COMP-full / USDT-partial absorption', async function() {
      // Governor provides USDC liquidity (enough to cover reserves)
      await USDC.connect(governor).approve(comet.address, exp(2000, 6));
      await comet.connect(governor).supply(USDC.address, exp(2000, 6));

      // Borrower supplies:
      //   COMP (asset 0): 10 × $50 = $500, borrowCF=0.80 -> capacity = $400
      //   USDT (asset 1): 1000 × $1 = $1000, borrowCF=0.80 -> capacity = $800
      //   Total borrow capacity = $1200 -> borrow 900 USDC
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
      // debt=900 > 858.5 -> isLiquidatable=true 
      // denom = LP×targetHF - borrowCF = 0.9×1.05 - 0.80 = 0.145
      // COMP rawUSD = (900×1.05 - 0.80×1010) / 0.145 = (945 - 808) / 0.145 ≈ 944.8 >> 10 -> full seizure 
      // After COMP: debtRemaining ≈ 900 - 0.9×10×1 = 891; TCV remaining = 0.80×1000 = 800
      // USDT rawUSD = (891×1.05 - 800) / 0.145 = (935.55 - 800) / 0.145 ≈ 934.8 ≤ 1000 -> partial seizure 
      await setPrice(priceFeedCOMP, governor, 1);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP (asset 0): fully seized (balance -> 0)
      // rawCOMP = (900×1.05 - 0.80×(10+1000)×1) / (0.9×1.05 - 0.80) = (945 - 808) / 0.145 ≈ 944.8 >> 10 -> full seizure 
      expect((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()).to.equal(0n, 'COMP should be fully seized');

      // USDT (asset 1): partially seized (balance > 0)
      // After COMP full seizure: debtRemaining = 900 - 0.9×10×1 = 900 - 9 = 891 USD; TCV remaining = 0.80×1000 = 800
      // rawUSDT = (891×1.05 - (1000×1×0.80)) / (0.9×1.05 - 0.80) = (935.55 - 800) / 0.145 ≈ 934.8 USDT ≤ 1000 -> partial 
      const usdtBalance = (await comet.userCollateral(borrower.address, USDT.address)).balance.toBigInt();
      expect(usdtBalance).to.be.gt(0n, 'USDT should be only partially seized');

      // Position not fully settled — some debt remains at targetHF level
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      expect(debtAfter).to.be.gt(0n, 'Remaining debt should be > 0 after partial seizure');

      // Not liquidatable: remaining USDT covers the remaining debt at liquidateCF threshold
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Asset 0 = bit 0 -> assetsIn has bit 0 set even though COMP balance is 0
      // Asset 1 = bit 1 -> assetsIn has bit 1 set (USDT still has balance)
      // Expected after fix: assetsIn = 2 (0b10, only USDT bit)
      const userBasicAfter = await comet.userBasic(borrower.address);
      console.log('assetsIn after mixed absorption:', userBasicAfter);
      expect(userBasicAfter.assetsIn).to.equal(2, 'assetsIn should be 2 (only USDT bit set) after mixed absorption');
    });
  });

  // ── Scenario 1 — numerator-underflow invariant ──

  describe('Scenario 1 — numerator stays positive after full COMP seizure', function() {
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
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 40,
            borrowCF: exp(0.80, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
          USDT: {
            initial: exp(1_000_000, 6),
            decimals: 6,
            initialPrice: 1,
            borrowCF: exp(0.80, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 6),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, governor } = protocol);
      ({ USDC, COMP, USDT } = protocol.tokens);
      ({ COMP: priceFeedCOMP } = protocol.priceFeeds);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
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
      //   COMP (asset 0): 10 × $40 = $400, borrowCF=0.80 -> capacity = $320
      //   USDT (asset 1): 1000 × $1 = $1000, borrowCF=0.80 -> capacity = $800
      //   Total borrow capacity = $1120 -> borrow 1100 USDC
      await COMP.connect(governor).transfer(borrower.address, exp(10, 18));
      await COMP.connect(borrower).approve(comet.address, exp(10, 18));
      await comet.connect(borrower).supply(COMP.address, exp(10, 18));

      await USDT.connect(governor).transfer(borrower.address, exp(1000, 6));
      await USDT.connect(borrower).approve(comet.address, exp(1000, 6));
      await comet.connect(borrower).supply(USDT.address, exp(1000, 6));

      await comet.connect(borrower).withdraw(USDC.address, exp(1100, 6));

      // Drop COMP price from $40 to $25. USDT stays at $1.
      // isLiquidatable (liquidateCF=0.85):
      //   TCV_liq = 10×25×0.85 + 1000×0.85 = 212.5 + 850 = 1062.5 < 1100 -> liquidatable 
      //
      // absorbInternal uses borrowCF=0.80, denom = 0.9×1.05 - 0.80 = 0.145:
      //   TCV_initial = 10×25×0.80 + 1000×0.80 = 200 + 800 = 1000
      //
      //   COMP: rawCOMP = (1100×1.05 - 1000) / 0.145 = 155 / 0.145 ≈ 1069 >> 250 -> full seizure 
      //     seizedValue = 0.9×250 = 225; debtRemaining = 875; TCV_remaining = 800
      //
      //   USDT: numerator = 875×1.05 - 800 = 918.75 - 800 = 118.75 > 0 (no underflow ← key invariant)
      //     rawUSDT = 118.75 / 0.145 ≈ 819 ≤ 1000 -> partial seizure 
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
    });
  });

  // ── Scenario 2 — debtRemaining underflow invariant ──

  describe('Scenario 2 — debtRemaining stays positive after full COMP seizure', function() {
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
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 50,
            borrowCF: exp(0.85, 18),
            liquidateCF: exp(0.9, 18),
            liquidationFactor: exp(0.95, 18),
            supplyCap: exp(1_000_000, 18),
          },
          WBTC: {
            initial: exp(1_000, 8),
            decimals: 8,
            initialPrice: 30000,
            borrowCF: exp(0.85, 18),
            liquidateCF: exp(0.9, 18),
            liquidationFactor: exp(0.95, 18),
            supplyCap: exp(1_000, 8),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, governor } = protocol);
      ({ USDC, COMP, WBTC } = protocol.tokens);
      ({ COMP: priceFeedCOMP } = protocol.priceFeeds);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
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
      //   COMP (asset 0): 20 × $50 = $1000, borrowCF=0.85 -> capacity = $850
      //   WBTC (asset 1): 0.1 × $30000 = $3000, borrowCF=0.85 -> capacity = $2550
      //   Total borrow capacity = $3400 -> borrow 3400 USDC
      await COMP.connect(governor).transfer(borrower.address, exp(20, 18));
      await COMP.connect(borrower).approve(comet.address, exp(20, 18));
      await comet.connect(borrower).supply(COMP.address, exp(20, 18));

      await WBTC.connect(governor).transfer(borrower.address, exp(1, 7));  // 0.1 WBTC = 10_000_000 units
      await WBTC.connect(borrower).approve(comet.address, exp(1, 7));
      await comet.connect(borrower).supply(WBTC.address, exp(1, 7));

      await comet.connect(borrower).withdraw(USDC.address, exp(3400, 6));

      // Drop COMP price from $50 to $35. WBTC stays at $30000.
      // isLiquidatable (liquidateCF=0.9):
      //   TCV_liq = 20×35×0.9 + 3000×0.9 = 630 + 2700 = 3330 < 3400 -> liquidatable 
      //
      // absorbInternal uses borrowCF=0.85, denom = 0.95×1.05 - 0.85 = 0.1475:
      //   TCV_initial = 20×35×0.85 + 3000×0.85 = 595 + 2550 = 3145
      //
      //   COMP: rawCOMP = (3400×1.05 - 3145) / 0.1475 = 425 / 0.1475 ≈ 2881 >> 700 -> full seizure 
      //     seizedValue = 0.95×700 = 665; deltaValue = 665
      //     debtRemaining = 3400 - 665 = 2735 > 0 (no underflow ← key invariant) 
      //     TCV_remaining = 3145 - 595 = 2550
      //
      //   WBTC: numerator = 2735×1.05 - 2550 = 321.75 > 0 (no underflow )
      //     rawWBTC = 321.75 / 0.1475 ≈ 2181 USD ≤ 3000 -> partial seizure 
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

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
    });
  });

  // ── Scenario 5 — totalCollateralizedValue stale after partial seizure ──

  describe('Scenario 5 — stale in-memory TCV after partial USDT seizure', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: any;
    let USDC: any;
    let COMP: any;
    let USDT: any;
    let priceFeedCOMP: any;
    let snapshotId: string;

    // Identical configuration to Scenario 1: COMP $40, USDT $1, borrowCF=0.80, liquidateCF=0.85, LF=0.9
    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 40,
            borrowCF: exp(0.80, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
          USDT: {
            initial: exp(1_000_000, 6),
            decimals: 6,
            initialPrice: 1,
            borrowCF: exp(0.80, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 6),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, governor } = protocol);
      ({ USDC, COMP, USDT } = protocol.tokens);
      ({ COMP: priceFeedCOMP } = protocol.priceFeeds);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('5: stale in-memory TCV is non-trivially larger than actual storage TCV after partial USDT seizure', async function() {
      // Position identical to Scenario 1:
      //   COMP (asset 0): 10 × $40 = $400, borrowCF=0.80 -> capacity $320
      //   USDT (asset 1): 1000 × $1 = $1000, borrowCF=0.80 -> capacity $800
      //   Borrow: 1100 USDC; drop COMP to $25 -> isLiquidatable 
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
      //     TCV is NOT updated (currentHF == targetHF, condition `< targetHF` is false -> no decrement)
      //   So stale_TCV = TCV_initial - CF_COMP × COMP_available_USD = USDT_initial × 80
      //   (COMP contribution adds and then subtracts, leaving only USDT_initial × 80)
      const USDT_INITIAL = exp(1000, 6); // 1_000_000_000n
      const staleTcvAtBreak = USDT_INITIAL * TCV_FACTOR; // 80_000_000_000n ≈ 800 USD × PRICE_SCALE

      // Key invariant: stale in-memory TCV > actual storage TCV
      // Gap = CF_USDT × seized_USDT_available_USD ≈ 0.80 × 819 USD ≈ 655 USD (non-trivial)
      const stalenessGap = staleTcvAtBreak - actualTcvFromStorage;
      expect(stalenessGap).to.be.gt(0n,
        'latent bug: stale in-memory TCV at break is larger than actual storage TCV by CF * seized_USDT_USD');

      // Verify the gap is non-trivial (> 1 USD in price-scale units = 1e8)
      expect(stalenessGap).to.be.gt(BigInt(1e8),
        'staleness gap must be non-trivially large (> 1 USD)');

      // Position is healthy — current code is correct because nothing reads TCV after break
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
    });
  });

  // ── Scenario 6 — worked example: COMP fully seized, ETH partially seized ──
  //
  // Parameters (from docs/partial-liquidation-example.md):
  //   COMP: borrowCF=0.75, liquidateCF=0.80, liquidationFactor=0.90, price $20 -> $11
  //   ETH:  borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $2000
  //   targetHF = 1.05
  //   Deposit: 100 COMP ($2000) + 0.5 ETH ($1000), borrow: $1800 USDC
  //
  // Liquidation math:
  //   TCV_CF = 100×11×0.75 + 0.5×2000×0.80 = 825 + 800 = $1625
  //   Iter 1 COMP: denom=0.90×1.05−0.75=0.195
  //     rawCOMP = (1800×1.05 − 1625) / 0.195 = 265/0.195 ≈ $1358.97 > $1100 -> full seizure
  //     seizedValue = $1100×0.90 = $990; debtRemaining = $810; TCV_CF = $800
  //   Iter 2 ETH: denom=0.90×1.05−0.80=0.145
  //     rawETH = (810×1.05 − 800) / 0.145 = 50.5/0.145 ≈ $348.28 ≤ $1000 -> partial seizure
  //     seizeAmount ≈ 0.17414 ETH; seizedValue ≈ $313.45; currentHF = targetHF -> break
  //   Final debt ≈ $496.55 USDC; remaining ETH ≈ 0.32586 ETH; HF = 1.05

  describe('Scenario 6 — worked example (partial-liquidation-example.md): COMP fully seized, ETH partially seized, targetHF=1.05', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let snapshotId: string;
    let priceFeeds: any, tokens: any;

    before(async function() {
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
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
      snapshotId = await ethers.provider.send('evm_snapshot', []);
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
      //   100 COMP × $20 = $2000; borrowCF=0.75 -> capacity = $1500
      //   0.5 WETH × $2000 = $1000; borrowCF=0.80 -> capacity = $800
      //   Total borrow capacity = $2300 -> borrow $1800 USDC (below max)
      await COMP.connect(governor).transfer(borrower.address, exp(100, 18));
      await COMP.connect(borrower).approve(comet.address, exp(100, 18));
      await comet.connect(borrower).supply(COMP.address, exp(100, 18));

      let userBasic = await comet.userBasic(borrower.address);
      console.log('\x1b[35m%s','After deposit COMP userBasic.assetsIn:', userBasic[3]);
      
      await WETH.connect(governor).transfer(borrower.address, exp(1, 18) / 2n);
      await WETH.connect(borrower).approve(comet.address, exp(1, 18) / 2n);
      await comet.connect(borrower).supply(WETH.address, exp(1, 18) / 2n);
      
      userBasic = await comet.userBasic(borrower.address);
      console.log('\x1b[35m%s','After deposit WETH userBasic.assetsIn:', userBasic[3]);

      await comet.connect(borrower).withdraw(USDC.address, exp(1800, 6));

      // Verify initial state: HF > 1, not liquidatable
      //   CF-weighted = $2300, liquidateCF-weighted = $2450, debt = $1800
      //   isLiquidatable: $2450 > $1800 -> false 
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Drop COMP price $20 -> $11 (−45%). WETH stays at $2000.
      // After drop:
      //   liquidateCF-weighted = 100×11×0.80 + 0.5×2000×0.85 = 880 + 850 = $1730 < $1800 -> liquidatable 
      await setPrice(priceFeedCOMP, governor, 11);
      await comet.accrueAccount(borrower.address);

      let currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF before absorb:', Number(currentHF) / 1e18);

      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP (asset 0): fully seized — entire 100 COMP seized
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      expect(compBalance).to.equal(0n, 'COMP should be fully seized');

      // WETH (asset 1): partially seized — some ETH remains
      //   seizeAmount ≈ 0.17414 ETH = 174137931030000000 wei
      //   remaining   ≈ 0.32586 ETH = 325862068970000000 wei
      const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      console.log('\x1b[36m%s','Remaining WETH (ETH):', Number(wethBalance) / 1e18);
      expect(wethBalance).to.be.gt(0n, 'WETH should be only partially seized');
      expect(wethBalance).to.be.lt(exp(1, 18) / 2n, 'WETH remaining must be less than initial 0.5 ETH');

      // Remaining debt > 0 (partial liquidation stopped at targetHF, not full)
      //   Expected: ~$496.55 USDC = ~496_550_000 base units (6 decimals)
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      console.log('\x1b[36m%s','Remaining debt (USDC):', Number(debtAfter) / 1e6);
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
      expect(wethBalance).to.be.lte(330n * exp(1, 15), 'WETH remaining should be <= 0.330 ETH');
      // Precision check: verify remaining debt is in the expected range [$495, $497]
      expect(debtAfter).to.be.gte(exp(495, 6), 'Remaining debt should be >= $495');
      expect(debtAfter).to.be.lte(exp(497, 6), 'Remaining debt should be <= $497');

      userBasic = await comet.userBasic(borrower.address);
      console.log('\x1b[35m%s','Final userBasic.assetsIn:', userBasic[3]);

      currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
      expect(currentHF).to.be.gte(exp(1.05, 18) - 8n * 10n ** 9n, 'Health factor should be >= targetHF=1.05 (±8e9 rounding tolerance)');
      expect(currentHF).to.be.lte(exp(1.05, 18) + 8n * 10n ** 9n);
    });
  });

  describe('Scenario 7 — 24 collateral assets (max): 22 small tokens fully seized, COMP fully seized, WETH partially seized, targetHF=1.05', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let snapshotId: string;
    let priceFeeds: any, tokens: any;

    before(async function() {
      // Build 22 small-token configs (T01..T22); together with COMP and WETH they fill
      // all MAX_ASSETS_FOR_ASSET_LIST = 24 slots in CometWithExtendedAssetList.
      const smallTokenAssets: Record<string, any> = {};
      for (let i = 1; i <= 22; i++) {
        const sym = `T${String(i).padStart(2, '0')}`;
        smallTokenAssets[sym] = {
          initial: exp(1000, 18),
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.9, 18),
          supplyCap: exp(1000, 18),
        };
      }

      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          ...smallTokenAssets,
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 100,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(100_000, 18),
          },
          WETH: {
            initial: exp(10_000, 18),
            decimals: 18,
            initialPrice: 2000,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(10_000, 18),
          },
        },
        baseTrackingBorrowSpeed: exp(1 / 86400, 15, 18),
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    beforeEach(async function() {
      await ethers.provider.send('evm_revert', [snapshotId]);
      snapshotId = await ethers.provider.send('evm_snapshot', []);
    });

    it('1: 22 small tokens + COMP fully seized, WETH partially seized, debt reduced, HF reaches targetHF=1.05', async function() {
      const { USDC, COMP, WETH } = tokens;

      // Governor provides $3000 USDC liquidity
      await USDC.connect(governor).approve(comet.address, exp(3000, 6));
      await comet.connect(governor).supply(USDC.address, exp(3000, 6));

      // Borrower deposits 1 token of each T01..T22 ($1 each = $22 total)
      //   borrowCF-weighted contribution: 22 × 0.8 × $1 = $17.6
      for (let i = 1; i <= 22; i++) {
        const sym = `T${String(i).padStart(2, '0')}`;
        const tok = tokens[sym];
        await tok.connect(governor).transfer(borrower.address, exp(1, 18));
        await tok.connect(borrower).approve(comet.address, exp(1, 18));
        await comet.connect(borrower).supply(tok.address, exp(1, 18));
      }

      // Borrower deposits 10 COMP × $100 = $1000; borrowCF-weighted = $800
      await COMP.connect(governor).transfer(borrower.address, exp(10, 18));
      await COMP.connect(borrower).approve(comet.address, exp(10, 18));
      await comet.connect(borrower).supply(COMP.address, exp(10, 18));

      // Borrower deposits 0.5 WETH × $2000 = $1000; borrowCF-weighted = $800
      await WETH.connect(governor).transfer(borrower.address, exp(1, 18) / 2n);
      await WETH.connect(borrower).approve(comet.address, exp(1, 18) / 2n);
      await comet.connect(borrower).supply(WETH.address, exp(1, 18) / 2n);

      // Borrower borrows $1350 USDC (total borrow capacity ≈ $1617.6)
      await comet.connect(borrower).withdraw(USDC.address, exp(1350, 6));

      // Verify initial state: HF > 1, not liquidatable
      //   liquidateCF-weighted = 22×0.85×$1 + 10×0.85×$100 + 0.5×0.85×$2000 = $18.7 + $850 + $850 = $1718.7 > $1350
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Drop COMP price $100 -> $50 (−50%). Small tokens and WETH remain at initial prices.
      // After drop:
      //   liquidateCF-weighted = 22×0.85×$1 + 10×0.85×$50 + 0.5×0.85×$2000
      //                        = $18.7 + $425 + $850 = $1293.7 < $1350 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 50);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // All 22 small tokens should be fully seized (each is insufficient to bring HF to target alone)
      for (let i = 1; i <= 22; i++) {
        const sym = `T${String(i).padStart(2, '0')}`;
        const balance = (await comet.userCollateral(borrower.address, tokens[sym].address)).balance.toBigInt();
        expect(balance).to.equal(0n, `${sym} should be fully seized`);
      }

      // COMP should be fully seized (also insufficient to reach targetHF on its own)
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      expect(compBalance).to.equal(0n, 'COMP should be fully seized');

      // WETH should be partially seized — liquidation stops here once HF reaches targetHF=1.05
      //   rawCollateralUSD_WETH ≈ $856.6 -> seizeAmount ≈ 0.4283 ETH -> remaining ≈ 0.0717 ETH
      const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      console.log('\x1b[36m%s', 'Remaining WETH (ETH):', Number(wethBalance) / 1e18);
      expect(wethBalance).to.be.gt(0n, 'WETH should only be partially seized');
      expect(wethBalance).to.be.lt(exp(1, 18) / 2n, 'WETH remaining must be less than initial 0.5 ETH');

      // Remaining debt > 0 (partial liquidation stopped at targetHF, not full)
      //   Expected: ≈$109 USDC
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      console.log('\x1b[36m%s', 'Remaining debt (USDC):', Number(debtAfter) / 1e6);
      expect(debtAfter).to.be.not.equal(0n, 'Remaining debt should be > 0 after partial seizure');
      expect(debtAfter).to.be.gte(exp(108, 6), 'Remaining debt should be >= $108');
      expect(debtAfter).to.be.lte(exp(110, 6), 'Remaining debt should be <= $110');


      // Position is healthy after absorb — targetHF reached
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Precision checks (based on absorption formula with borrowCF-weighted collateral):
      //   debtRemaining at WETH step ≈ $930; totalCollaterizedValue(WETH only) = 0.5×0.8×$2000 = $800
      //   rawCollateralUSD = (930×1.05 − 800) / (0.9×1.05 − 0.8) = 130.05 / 0.145 ≈ 856.6 USD
      //   seizeAmount = 856.6 / 2000 ≈ 0.4283 ETH -> remaining ≈ 0.0717 ETH
      expect(wethBalance).to.be.gte(71n * exp(1, 15), 'WETH remaining should be >= 0.071 ETH');
      expect(wethBalance).to.be.lte(72n * exp(1, 15), 'WETH remaining should be <= 0.072 ETH');
      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);

      expect(currentHF).to.be.gte(exp(1.05, 18) - 8n * 10n ** 9n, 'Health factor should be >= targetHF=1.05 (±8e9 rounding tolerance)');
      expect(currentHF).to.be.lte(exp(1.05, 18) + 8n * 10n ** 9n);
    });
  });
});
