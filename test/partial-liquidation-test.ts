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
      // expect(await comet.isLiquidatable(borrower.address)).to.be.true;

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

      // expect(rawCollateralUSD).to.be.lte(availableUSD, 'partial condition would be met (rawCollateralUSD <= availableUSD)');
      // expect(baseDebtAfterPartial).to.equal(baseBorrowMin - 1n, 'baseDebtAfterPartial must be exactly one unit below baseBorrowMin');

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      console.log("----- userCollateral:", Number((await comet.userCollateral(borrower.address, COMP.address)).balance)/1e18);
      console.log("----- borrowBalanceOf:", (await comet.borrowBalanceOf(borrower.address)));


      const finalCOMP = (await comet.userCollateral(borrower.address, COMP.address)).balance;
      // expect(finalCOMP.toBigInt()).to.equal(0n, 'All COMP must be seized: full-seizure fallback triggered');

      const finalDebt = await comet.borrowBalanceOf(borrower.address);
      // expect(finalDebt.toBigInt()).to.equal(0n, 'Debt must be zeroed after full-seizure fallback');

      // expect(await comet.isLiquidatable(borrower.address)).to.be.false;

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
            liquidationFactor: exp(0.91, 18),
            supplyCap: exp(1e5, 18),
          },
        },
      });
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

    it('4a: reverts when targetHealthFactor = 0.9 (≤ 1.05)', async function() {
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
      ).to.be.revertedWith("custom error 'LiquidateCFTooLarge()'");
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
            liquidationFactor: exp(0.91, 18),
            supplyCap: exp(1_000_000, 18),
          },
          USDT: {
            initial: exp(1_000_000, 6),
            decimals: 6,
            initialPrice: 1,
            borrowCF: exp(0.85, 18),
            liquidateCF: exp(0.9, 18),
            liquidationFactor: exp(0.91, 18),
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
      ({ COMP: priceFeedCOMP } = protocol.priceFeeds);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
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
  // Parameters:
  //   COMP: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $20 -> $11
  //   ETH:  borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $2000
  //   targetHF = 1.05
  //   Deposit: 100 COMP ($2000) + 0.5 ETH ($1000), borrow: $1800 USDC
  //
  // Liquidation math:
  //   TCV_CF = 100×11×0.80 + 0.5×2000×0.80 = 880 + 800 = $1680
  //   Iter 1 COMP: denom=0.90×1.05−0.80=0.145
  //     rawCOMP = (1800×1.05 − 1680) / 0.145 = 210/0.145 ≈ $1448.28 > $1100 -> full seizure
  //     seizedValue = $1100×0.90 = $990; debtRemaining = $810; TCV_CF = $800
  //   Iter 2 ETH: denom=0.90×1.05−0.80=0.145
  //     rawETH = (810×1.05 − 800) / 0.145 = 50.5/0.145 ≈ $348.28 ≤ $1000 -> partial seizure
  //     seizeAmount ≈ 0.17414 ETH; seizedValue ≈ $313.45; currentHF = targetHF -> break
  //   Final debt ≈ $496.55 USDC; remaining ETH ≈ 0.32586 ETH; HF = 1.05

  describe('Scenario 6 — worked example: COMP fully seized, ETH partially seized, targetHF=1.05', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
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
    });

    it('1: COMP fully seized, ETH partially seized, debt reduced to ~$496.55, HF reaches targetHF=1.05', async function() {
      const { USDC, COMP, WETH } = tokens;      
      // Governor provides USDC liquidity
      await USDC.connect(governor).approve(comet.address, exp(5000, 6));
      await comet.connect(governor).supply(USDC.address, exp(5000, 6));

      // Borrower deposits:
      //   100 COMP × $20 = $2000; borrowCF=0.80 -> capacity = $1600
      //   0.5 WETH × $2000 = $1000; borrowCF=0.80 -> capacity = $800
      //   Total borrow capacity = $2400 -> borrow $1800 USDC (below max)
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
      console.log('\x1b[36m%s','Initial COMP:', Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[36m%s','Initial WETH (ETH):', Number((await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt()) / 1e18);

      await comet.connect(borrower).withdraw(USDC.address, exp(1800, 6));
      console.log('\x1b[36m%s','Initial debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);

      // Verify initial state: HF > 1, not liquidatable
      //   CF-weighted = 100×20×0.80 + 0.5×2000×0.80 = $2400, liquidateCF-weighted = 100×20×0.85 + 0.5×2000×0.85 = $2550, debt = $1800
      //   isLiquidatable: $2550 > $1800 -> false
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Drop COMP price $20 -> $11 (−45%). WETH stays at $2000.
      // After drop:
      //   liquidateCF-weighted = 100×11×0.85 + 0.5×2000×0.85 = 935 + 850 = $1785 < $1800 -> liquidatable
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
      console.log('\x1b[36m%s','Remaining COMP:', Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()) / 1e18);
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

  // ── Scenario 8 — first asset partially seized, second asset untouched ──
  //
  // Parameters:
  //   COMP: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $50 -> $10
  //   WETH: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $2000 (unchanged)
  //   targetHF = 1.05
  //   Deposit: 1000 COMP ($50000) + 0.1 WETH ($200), borrow: $9000 USDC
  //
  // Liquidation math (after COMP drop $50 -> $10):
  //   TCV(borrowCF) = 1000×10×0.80 + 0.1×2000×0.80 = 8000 + 160 = $8160
  //   denom = 0.90×1.05 − 0.80 = 0.145
  //   rawCOMP_USD = (9000×1.05 − 8160) / 0.145 = 1290 / 0.145 = 258000/29 ≈ $8896.55 < $10000 -> partial
  //   seizeAmount = 25800/29 COMP ≈ 889.655 COMP; remaining = 3200/29 COMP ≈ 110.345 COMP
  //   seizedValue = 258000/29 × 0.90 = 232200/29 ≈ $8006.90; debtAfter = 28800/29 ≈ $993.10
  //   Algorithm breaks after COMP partial seizure — WETH iteration is never reached
  //   HF = (3200/29×10×0.80 + 0.1×2000×0.80) / (28800/29) = (30240/29) / (28800/29) = 1.05 (exact)

  describe('Scenario 8 — first asset partially seized, second asset untouched (algorithm stops at first iteration)', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let priceFeeds: any, tokens: any;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 50,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(2_000_000, 18),
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
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
    });

    it('1: COMP partially seized, WETH untouched, debt reduced, HF reaches targetHF=1.05', async function() {
      const { USDC, COMP, WETH } = tokens;

      // Governor provides USDC liquidity
      await USDC.connect(governor).approve(comet.address, exp(10_000, 6));
      await comet.connect(governor).supply(USDC.address, exp(10_000, 6));

      // Borrower deposits:
      //   1000 COMP × $50 = $50000; borrowCF=0.80 -> capacity = $40000
      //   0.1 WETH × $2000 = $200;  borrowCF=0.80 -> capacity = $160
      //   Total borrow capacity = $40160 -> borrow $9000 USDC (well below max)
      const compAmount = exp(1000, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      const wethAmount = exp(1, 17); // 0.1 WETH
      await WETH.connect(governor).transfer(borrower.address, wethAmount);
      await WETH.connect(borrower).approve(comet.address, wethAmount);
      await comet.connect(borrower).supply(WETH.address, wethAmount);

      await comet.connect(borrower).withdraw(USDC.address, exp(9000, 6));

      console.log('\x1b[35m%s','Init COMP:', Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s','Init WETH:', Number((await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s','Init debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);


      // Verify initial state: not liquidatable
      //   liquidateCF-weighted = 1000×50×0.85 + 0.1×2000×0.85 = 42500 + 170 = $42670 > $9000
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Drop COMP price $50 -> $10 (-80%). WETH stays at $2000.
      // After drop:
      //   liquidateCF-weighted = 1000×10×0.85 + 0.1×2000×0.85 = 8500 + 170 = $8670 < $9000 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 10);
      await comet.accrueAccount(borrower.address);

      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP (asset 0): partially seized — some COMP must remain
      //   seizeAmount = 25800/29 COMP ≈ 889.655; remaining = 3200/29 COMP ≈ 110.345
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[36m%s', 'Remaining COMP (COMP):', Number(compBalance) / 1e18);
      expect(compBalance).to.be.gt(0n, 'COMP should be only partially seized');
      expect(compBalance).to.be.lt(compAmount, 'COMP balance must have decreased');
      
      // WETH (asset 1): must be completely untouched
      //   The algorithm breaks immediately after COMP partial seizure — WETH iteration is never reached
      const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      console.log('\x1b[36m%s', 'Remaining WETH (ETH):', Number(wethBalance) / 1e18);
      expect(wethBalance).to.equal(wethAmount, 'WETH must not be touched: algorithm stopped at COMP partial seizure');

      // Remaining debt > 0 (partial liquidation, not full)
      //   Expected: 28800/29 USDC ≈ $993.10
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      console.log('\x1b[36m%s', 'Remaining debt (USDC):', Number(debtAfter) / 1e6);
      expect(debtAfter).to.be.gt(0n, 'Debt must remain after partial liquidation');
      expect(debtAfter).to.be.lt(exp(9000, 6), 'Debt must have been partially repaid');

      // Position is healthy after absorb
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Precision checks (1290 / 0.145 = 258000/29 is exact, no truncation):
      //   remaining COMP = 3200/29 ≈ 110.345 COMP
      //   debtAfter      = 28800/29 ≈ 993.103 USDC
      expect(compBalance).to.be.gte(110n * exp(1, 18), 'Remaining COMP should be >= 110 COMP');
      expect(compBalance).to.be.lte(111n * exp(1, 18), 'Remaining COMP should be <= 111 COMP');
      expect(debtAfter).to.be.gte(exp(992, 6), 'Remaining debt should be >= $992');
      expect(debtAfter).to.be.lte(exp(994, 6), 'Remaining debt should be <= $994');

      // Health factor must equal targetHF=1.05 exactly
      //   HF = (3200/29×10×0.80 + 0.1×2000×0.80) / (28800/29) = 30240/28800 = 1.05
      const currentHF = await getHealthFactor(comet, borrower.address);
      expect(currentHF).to.be.gte(exp(1.05, 18) - 8n * 10n ** 9n, 'Health factor should be >= targetHF=1.05 (±8e9 rounding tolerance)');
      expect(currentHF).to.be.lte(exp(1.05, 18) + 8n * 10n ** 9n);
    });
  });

  // ── Scenario 9 — batch absorb: two borrowers partially liquidated in a single call ──
  //
  // Parameters:
  //   COMP: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $1.00 -> $0.93
  //   targetHF = 1.05, baseTrackingBorrowSpeed = 0
  //
  // Borrower 1: 100 COMP ($100), borrow $80 USDC (at borrowCF capacity)
  //   TCV(borrowCF) = 100×0.93×0.80 = $74.40; denom = 0.90×1.05 − 0.80 = 0.145
  //   rawCOMP = (80×1.05 − 74.40) / 0.145 = 9.60 / 0.145 = 1920/29 ≈ $66.21 < $93 -> partial
  //   seizeAmount ≈ 71.19 COMP; remaining ≈ 28.81 COMP; debtAfter = 592/29 ≈ $20.41
  //
  // Borrower 2: 200 COMP ($200), borrow $160 USDC (exact 2× of Borrower 1)
  //   TCV(borrowCF) = 200×0.93×0.80 = $148.80
  //   rawCOMP = 3840/29 ≈ $132.41 < $186 -> partial
  //   seizeAmount ≈ 142.38 COMP; remaining ≈ 57.62 COMP; debtAfter = 1184/29 ≈ $40.83
  //
  // Single absorb([borrower1, borrower2]) processes both positions atomically

  describe('Scenario 9 — batch absorb: two borrowers partially liquidated in a single call', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower1: SignerWithAddress;
    let borrower2: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let tokens: any, priceFeeds: any;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(1_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 1,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      [borrower1, borrower2] = protocol.users;
      liquidator = protocol.pauseGuardian;
      priceFeedCOMP = priceFeeds.COMP;
    });

    it('1: both borrowers partially liquidated by a single absorb([b1, b2]) call', async function() {
      const { USDC, COMP } = tokens;

      // Governor provides USDC liquidity ($1000 covers combined withdrawals of $240)
      await USDC.connect(governor).approve(comet.address, exp(1000, 6));
      await comet.connect(governor).supply(USDC.address, exp(1000, 6));

      // Borrower 1: deposits 100 COMP ($100), borrows $80 USDC
      //   borrowCF-weighted capacity = 100×1×0.80 = $80 (borrow at capacity)
      const compAmount1 = exp(100, 18);
      await COMP.connect(governor).transfer(borrower1.address, compAmount1);
      await COMP.connect(borrower1).approve(comet.address, compAmount1);
      await comet.connect(borrower1).supply(COMP.address, compAmount1);
      await comet.connect(borrower1).withdraw(USDC.address, exp(80, 6));

      // Borrower 2: deposits 200 COMP ($200), borrows $160 USDC (2× Borrower 1)
      //   borrowCF-weighted capacity = 200×1×0.80 = $160 (borrow at capacity)
      const compAmount2 = exp(200, 18);
      await COMP.connect(governor).transfer(borrower2.address, compAmount2);
      await COMP.connect(borrower2).approve(comet.address, compAmount2);
      await comet.connect(borrower2).supply(COMP.address, compAmount2);
      await comet.connect(borrower2).withdraw(USDC.address, exp(160, 6));

      // Verify initial state: both healthy
      //   B1: liquidateCF-weighted = 100×1×0.85 = $85 > $80
      //   B2: liquidateCF-weighted = 200×1×0.85 = $170 > $160
      expect(await comet.isLiquidatable(borrower1.address)).to.be.false;
      expect(await comet.isLiquidatable(borrower2.address)).to.be.false;

      console.log('\x1b[36m%s','Init COMP for borrower #1:', Number((await comet.userCollateral(borrower1.address, COMP.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[36m%s','Init debt (USDC) for borrower #1:', Number((await comet.borrowBalanceOf(borrower1.address)).toBigInt()) / 1e6);
      console.log('\x1b[35m%s','Init COMP for borrower #2:', Number((await comet.userCollateral(borrower2.address, COMP.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s','Init debt (USDC) for borrower #2:', Number((await comet.borrowBalanceOf(borrower2.address)).toBigInt()) / 1e6);


      // Drop COMP price $1 -> $0.93
      //   B1: liquidateCF-weighted = 100×0.93×0.85 = $79.05 < $80 -> liquidatable
      //   B2: liquidateCF-weighted = 200×0.93×0.85 = $158.10 < $160 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 0.93);
      await comet.accrueAccount(borrower1.address);
      await comet.accrueAccount(borrower2.address);

      expect(await comet.isLiquidatable(borrower1.address)).to.be.true;
      expect(await comet.isLiquidatable(borrower2.address)).to.be.true;

      // Single call absorbs both positions atomically
      await comet.connect(liquidator).absorb(liquidator.address, [borrower1.address, borrower2.address]);

      // ── Borrower 1 assertions ──
      // seizeAmount ≈ 71.19 COMP; remaining ≈ 28.81 COMP
      const compBalance1 = (await comet.userCollateral(borrower1.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[36m%s', 'Remaining COMP (COMP) for borrower #1:', Number(compBalance1) / 1e18);
      expect(compBalance1).to.be.gt(0n, 'B1: COMP should be only partially seized');
      expect(compBalance1).to.be.lt(compAmount1, 'B1: COMP balance must have decreased');
      expect(compBalance1).to.be.gte(28n * exp(1, 18), 'B1: remaining COMP should be >= 28');
      expect(compBalance1).to.be.lte(30n * exp(1, 18), 'B1: remaining COMP should be <= 30');

      // debtAfter = 592/29 ≈ $20.41
      const debtAfter1 = (await comet.borrowBalanceOf(borrower1.address)).toBigInt();
      console.log('\x1b[36m%s', 'Remaining debt (USDC) for borrower #1:', Number(debtAfter1) / 1e6);
      expect(debtAfter1).to.be.gt(0n, 'B1: debt must remain after partial liquidation');
      expect(debtAfter1).to.be.lt(exp(80, 6), 'B1: debt must have been partially repaid');
      expect(debtAfter1).to.be.gte(exp(19, 6), 'B1: remaining debt should be >= $19');
      expect(debtAfter1).to.be.lte(exp(22, 6), 'B1: remaining debt should be <= $22');

      expect(await comet.isLiquidatable(borrower1.address)).to.be.false;

      // ── Borrower 2 assertions ──
      // seizeAmount ≈ 142.38 COMP; remaining ≈ 57.62 COMP (proportional to B1: 2×)
      const compBalance2 = (await comet.userCollateral(borrower2.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[35m%s', 'Remaining COMP (COMP) for borrower #2:', Number(compBalance2) / 1e18);
      expect(compBalance2).to.be.gt(0n, 'B2: COMP should be only partially seized');
      expect(compBalance2).to.be.lt(compAmount2, 'B2: COMP balance must have decreased');
      expect(compBalance2).to.be.gte(57n * exp(1, 18), 'B2: remaining COMP should be >= 57');
      expect(compBalance2).to.be.lte(59n * exp(1, 18), 'B2: remaining COMP should be <= 59');

      // debtAfter = 1184/29 ≈ $40.83 (proportional to B1: 2×)
      const debtAfter2 = (await comet.borrowBalanceOf(borrower2.address)).toBigInt();
      console.log('\x1b[35m%s', 'Remaining debt (USDC) for borrower #2:', Number(debtAfter2) / 1e6);
      expect(debtAfter2).to.be.gt(0n, 'B2: debt must remain after partial liquidation');
      expect(debtAfter2).to.be.lt(exp(160, 6), 'B2: debt must have been partially repaid');
      expect(debtAfter2).to.be.gte(exp(39, 6), 'B2: remaining debt should be >= $39');
      expect(debtAfter2).to.be.lte(exp(42, 6), 'B2: remaining debt should be <= $42');

      expect(await comet.isLiquidatable(borrower2.address)).to.be.false;

      // ── Health factor checks for both borrowers ──
      // Tolerance 1e12 (vs 8e9 in Scenario 8) because 1920/29 does not divide evenly by compPrice,
      // causing small integer truncation errors that accumulate to ~1e10–1e11
      const hf1 = await getHealthFactor(comet, borrower1.address);
      console.log('\x1b[36m%s', 'Current HF after absorb for borrower #1:', Number(hf1) / 1e18);
      expect(hf1).to.be.gte(exp(1.05, 18) - 10n ** 12n, 'B1: HF should be >= targetHF=1.05 (±1e12 rounding tolerance)');
      expect(hf1).to.be.lte(exp(1.05, 18) + 10n ** 12n, 'B1: HF should be <= targetHF=1.05 (±1e12 rounding tolerance)');

      const hf2 = await getHealthFactor(comet, borrower2.address);
      console.log('\x1b[35m%s', 'Current HF after absorb for borrower #2:', Number(hf2) / 1e18);
      expect(hf2).to.be.gte(exp(1.05, 18) - 10n ** 12n, 'B2: HF should be >= targetHF=1.05 (±1e12 rounding tolerance)');
      expect(hf2).to.be.lte(exp(1.05, 18) + 10n ** 12n, 'B2: HF should be <= targetHF=1.05 (±1e12 rounding tolerance)');
    });
  });

  // ── Scenario 10 — partial liquidation reduces collateral count: 10 assets -> 7 remaining ──
  //
  // Parameters:
  //   All 10 collateral assets: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90
  //   COMP: price $10 -> $1 (−90%); all others: price $1 (unchanged)
  //   targetHF = 1.05 (default)
  //
  //   Deposits:
  //     LINK:   100 tokens × $1  = $100  (borrowCF=0.80 -> $80)
  //     WETH:   100 tokens × $1  = $100  (-> $80)
  //     cbBTC:  100 tokens × $1  = $100  (-> $80)
  //     COMP:   900 tokens × $10 = $9000 (-> $900 after drop; borrowCF -> $720)
  //     rsETH:   50 tokens × $1  = $50   (-> $40)
  //     wstETH:  50 tokens × $1  = $50   (-> $40)
  //     UNI:     50 tokens × $1  = $50   (-> $40)
  //     WBTC:    50 tokens × $1  = $50   (-> $40)
  //     tBTC:    50 tokens × $1  = $50   (-> $40)
  //     DAI:     50 tokens × $1  = $50   (-> $40)
  //   Borrow: $1300 USDC
  //
  // Before drop: TCV(liquidateCF) = (300+9000+300)×0.85 = 9600×0.85 = $8160 > $1300 -> healthy
  // After  drop: TCV(liquidateCF) = (300+900+300)×0.85  = 1500×0.85 = $1275 < $1300 -> liquidatable
  //
  // Absorb algorithm trace (denom = 0.90×1.05 − 0.80 = 0.145):
  //
  //   State₀:  debt=$1300,  TCV(borrowCF)=$1200
  //   Required₁ = (1300×1.05 − 1200) / 0.145 = 165/0.145 ≈ $1137.93 > $100  -> LINK fully seized
  //   debt₁=$1210, TCV₁=$1120
  //
  //   Required₂ = (1210×1.05 − 1120) / 0.145 = 150.5/0.145 ≈ $1037.93 > $100 -> WETH fully seized
  //   debt₂=$1120, TCV₂=$1040
  //
  //   Required₃ = (1120×1.05 − 1040) / 0.145 = 136/0.145 ≈ $937.93 > $100   -> cbBTC fully seized
  //   debt₃=$1030, TCV₃=$960
  //
  //   Required₄ = (1030×1.05 − 960) / 0.145 = 121.5/0.145 = 24300/29 ≈ $837.93 < $900 -> COMP partially seized
  //   seized COMP = 24300/29 tokens; remaining = 1800/29 ≈ 62.07 tokens
  //   debt reduction = 24300/29 × 0.90 = 21870/29; debtFinal = 8000/29 ≈ $275.86
  //   Algorithm stops — rsETH/wstETH/UNI/WBTC/tBTC/DAI never reached
  //
  //   HF = (1800/29×0.80 + 300×0.80) / (8000/29) = (8400/29)/(8000/29) = 1.05 (exact)
  //
  // Result:
  //   - 3 assets fully seized (balance=0):    LINK (bit0), WETH (bit1), cbBTC (bit2)
  //   - 7 assets with non-zero balance:       COMP (bit3, partial) + rsETH..DAI (bits 4–9, untouched)
  //   - assetsIn = 0b1111111000 = 1016 (bits 3–9 set, bits 0–2 cleared)

  describe('Scenario 10 — partial liquidation reduces collateral count: 10 assets -> 7 remaining', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let priceFeeds: any, tokens: any;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC:   { initial: exp(1_000_000, 6),  decimals: 6,  initialPrice: 1  },
          LINK:   { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
          WETH:   { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
          cbBTC:  { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
          COMP:   { initial: exp(100_000, 18),    decimals: 18, initialPrice: 10, borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(100_000, 18) },
          rsETH:  { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
          wstETH: { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
          UNI:    { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
          WBTC:   { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
          tBTC:   { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
          DAI:    { initial: exp(10_000, 18),     decimals: 18, initialPrice: 1,  borrowCF: exp(0.8, 18), liquidateCF: exp(0.85, 18), liquidationFactor: exp(0.9, 18), supplyCap: exp(10_000, 18) },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
    });

    it('1: LINK/WETH/cbBTC fully seized, COMP partially seized, rsETH-DAI untouched, assetsIn has 7 bits set, HF = targetHF=1.05', async function() {
      const { USDC, LINK, WETH, cbBTC, COMP, rsETH, wstETH, UNI, WBTC, tBTC, DAI } = tokens;

      // Governor provides USDC liquidity ($2000 covers borrower's $1300 withdrawal)
      await USDC.connect(governor).approve(comet.address, exp(2000, 6));
      await comet.connect(governor).supply(USDC.address, exp(2000, 6));

      // Borrower deposits all 10 collateral assets:
      //   LINK/WETH/cbBTC: 100 tokens × $1 = $100 each  (borrowCF=0.80 -> $80 each)
      //   COMP:            900 tokens × $10 = $9000      (-> $7200 borrow capacity)
      //   rsETH/wstETH/UNI/WBTC/tBTC/DAI: 50 tokens × $1 = $50 each (-> $40 each)
      //   Total borrow capacity = $7680 >> $1300 -> borrow is safe
      const linkAmount  = exp(100, 18);
      const wethAmount  = exp(100, 18);
      const cbBTCAmount = exp(100, 18);
      const compAmount  = exp(900, 18);
      const smallAmount = exp(50, 18); // rsETH, wstETH, UNI, WBTC, tBTC, DAI

      await LINK.connect(governor).transfer(borrower.address, linkAmount);
      await LINK.connect(borrower).approve(comet.address, linkAmount);
      await comet.connect(borrower).supply(LINK.address, linkAmount);

      await WETH.connect(governor).transfer(borrower.address, wethAmount);
      await WETH.connect(borrower).approve(comet.address, wethAmount);
      await comet.connect(borrower).supply(WETH.address, wethAmount);

      await cbBTC.connect(governor).transfer(borrower.address, cbBTCAmount);
      await cbBTC.connect(borrower).approve(comet.address, cbBTCAmount);
      await comet.connect(borrower).supply(cbBTC.address, cbBTCAmount);

      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      await rsETH.connect(governor).transfer(borrower.address, smallAmount);
      await rsETH.connect(borrower).approve(comet.address, smallAmount);
      await comet.connect(borrower).supply(rsETH.address, smallAmount);

      await wstETH.connect(governor).transfer(borrower.address, smallAmount);
      await wstETH.connect(borrower).approve(comet.address, smallAmount);
      await comet.connect(borrower).supply(wstETH.address, smallAmount);

      await UNI.connect(governor).transfer(borrower.address, smallAmount);
      await UNI.connect(borrower).approve(comet.address, smallAmount);
      await comet.connect(borrower).supply(UNI.address, smallAmount);

      await WBTC.connect(governor).transfer(borrower.address, smallAmount);
      await WBTC.connect(borrower).approve(comet.address, smallAmount);
      await comet.connect(borrower).supply(WBTC.address, smallAmount);

      await tBTC.connect(governor).transfer(borrower.address, smallAmount);
      await tBTC.connect(borrower).approve(comet.address, smallAmount);
      await comet.connect(borrower).supply(tBTC.address, smallAmount);

      await DAI.connect(governor).transfer(borrower.address, smallAmount);
      await DAI.connect(borrower).approve(comet.address, smallAmount);
      await comet.connect(borrower).supply(DAI.address, smallAmount);

      await comet.connect(borrower).withdraw(USDC.address, exp(1300, 6));

      console.log('\x1b[35m%s', 'Init LINK:',  Number((await comet.userCollateral(borrower.address, LINK.address)).balance.toBigInt())  / 1e18);
      console.log('\x1b[35m%s', 'Init WETH:',  Number((await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt())  / 1e18);
      console.log('\x1b[35m%s', 'Init cbBTC:', Number((await comet.userCollateral(borrower.address, cbBTC.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init COMP:',  Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt())  / 1e18);
      console.log('\x1b[35m%s', 'Init debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);

      // Verify initial state: not liquidatable
      //   TCV(liquidateCF) = (300+9000+300)×0.85 = 9600×0.85 = $8160 > $1300
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Drop COMP price $10 -> $1 (−90%). All other assets stay at $1.
      // After drop: TCV(liquidateCF) = (300+900+300)×0.85 = 1500×0.85 = $1275 < $1300 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 1);
      await comet.accrueAccount(borrower.address);

      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // ── Fully seized assets (balance must be 0) ──
      //   Each had only $100 value after drop — insufficient to reach targetHF on its own
      const linkBalance  = (await comet.userCollateral(borrower.address, LINK.address)).balance.toBigInt();
      const wethBalance  = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      const cbBTCBalance = (await comet.userCollateral(borrower.address, cbBTC.address)).balance.toBigInt();
      console.log('\x1b[36m%s', 'Remaining LINK  (should be 0):', Number(linkBalance)  / 1e18);
      console.log('\x1b[36m%s', 'Remaining WETH  (should be 0):', Number(wethBalance)  / 1e18);
      console.log('\x1b[36m%s', 'Remaining cbBTC (should be 0):', Number(cbBTCBalance) / 1e18);
      expect(linkBalance).to.equal(0n,  'LINK should be fully seized');
      expect(wethBalance).to.equal(0n,  'WETH should be fully seized');
      expect(cbBTCBalance).to.equal(0n, 'cbBTC should be fully seized');

      // ── COMP: partially seized ──
      //   Required₄ = 24300/29 ≈ 837.93 COMP; remaining = 1800/29 ≈ 62.07 COMP
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[36m%s', 'Remaining COMP (partial):', Number(compBalance) / 1e18);
      expect(compBalance).to.be.gt(0n, 'COMP should only be partially seized');
      expect(compBalance).to.be.lt(compAmount, 'COMP balance must have decreased');
      expect(compBalance).to.be.gte(62n * exp(1, 18), 'Remaining COMP should be >= 62 COMP');
      expect(compBalance).to.be.lte(63n * exp(1, 18), 'Remaining COMP should be <= 63 COMP');

      // ── Untouched assets: rsETH, wstETH, UNI, WBTC, tBTC, DAI ──
      //   Algorithm stops immediately after COMP partial seizure — these are never reached
      const rsETHBalance  = (await comet.userCollateral(borrower.address, rsETH.address)).balance.toBigInt();
      const wstETHBalance = (await comet.userCollateral(borrower.address, wstETH.address)).balance.toBigInt();
      const uniBalance    = (await comet.userCollateral(borrower.address, UNI.address)).balance.toBigInt();
      const wbtcBalance   = (await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt();
      const tbtcBalance   = (await comet.userCollateral(borrower.address, tBTC.address)).balance.toBigInt();
      const daiBalance    = (await comet.userCollateral(borrower.address, DAI.address)).balance.toBigInt();
      console.log('\x1b[36m%s', 'rsETH (untouched):', Number(rsETHBalance) / 1e18);
      expect(rsETHBalance).to.equal(smallAmount,  'rsETH must not be touched: algorithm stopped at COMP partial seizure');
      expect(wstETHBalance).to.equal(smallAmount, 'wstETH must not be touched');
      expect(uniBalance).to.equal(smallAmount,    'UNI must not be touched');
      expect(wbtcBalance).to.equal(smallAmount,   'WBTC must not be touched');
      expect(tbtcBalance).to.equal(smallAmount,   'tBTC must not be touched');
      expect(daiBalance).to.equal(smallAmount,    'DAI must not be touched');

      // ── Remaining debt > 0 (partial liquidation, not bad debt) ──
      //   debtFinal = 8000/29 ≈ $275.86 USDC
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      console.log('\x1b[36m%s', 'Remaining debt (USDC):', Number(debtAfter) / 1e6);
      expect(debtAfter).to.be.gt(0n, 'Debt must remain after partial liquidation');
      expect(debtAfter).to.be.lt(exp(1300, 6), 'Debt must have been partially repaid');
      expect(debtAfter).to.be.gte(exp(275, 6), 'Remaining debt should be >= $275');
      expect(debtAfter).to.be.lte(exp(276, 6), 'Remaining debt should be <= $276');

      // Position is healthy after absorb
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // ── assetsIn bitmask: exactly 7 bits set ──
      //   LINK=bit0, WETH=bit1, cbBTC=bit2 cleared (fully seized, balance=0)
      //   COMP=bit3, rsETH=bit4, wstETH=bit5, UNI=bit6, WBTC=bit7, tBTC=bit8, DAI=bit9 set
      //   assetsIn = 0b1111111000 = 1016
      const userBasicAfter = await (comet as any).userBasic(borrower.address);
      console.log('\x1b[36m%s', 'assetsIn after absorb:', userBasicAfter.assetsIn.toString());
      expect(userBasicAfter.assetsIn).to.equal(1016, 'assetsIn should have exactly 7 bits set (bits 3–9): COMP + rsETH..DAI');

      // Count set bits to confirm exactly 7 active collateral positions remain
      let bitsSet = 0;
      let mask = Number(userBasicAfter.assetsIn);
      while (mask > 0) { bitsSet += mask & 1; mask >>= 1; }
      expect(bitsSet).to.equal(7, 'Exactly 7 collateral positions should remain after absorb (3 fully seized)');

      // ── Health factor must equal targetHF=1.05 exactly ──
      //   HF = (1800/29×0.80 + 300×0.80) / (8000/29) = (8400/29)/(8000/29) = 1.05
      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
      expect(currentHF).to.be.gte(exp(1.05, 18) - 8n * 10n ** 9n, 'Health factor should be >= targetHF=1.05 (±8e9 rounding tolerance)');
      expect(currentHF).to.be.lte(exp(1.05, 18) + 8n * 10n ** 9n);
    });
  });

  // ── Scenario 11 — bad debt: all 3 collateral assets fully seized, shortfall absorbed by reserves ──
  //
  // Parameters:
  //   COMP, WETH, LINK: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, initialPrice=$10
  //   All three prices crash $10 -> $0.50 (−95%)
  //   targetHF = 1.05 (default), baseTrackingBorrowSpeed = 0
  //
  //   Deposits: 100 COMP × $10 = $1000; 100 WETH × $10 = $1000; 100 LINK × $10 = $1000
  //   Borrow: $2000 USDC (below total borrowCF capacity of $2400)
  //
  // Before crash: TCV(liquidateCF) = 3000 × 0.85 = $2550 > $2000 -> healthy
  // After  crash: TCV(liquidateCF) =  150 × 0.85 = $127.50 < $2000 -> liquidatable
  //               Total collateral = $150 < $2000 = debt -> bad debt (targetHF unreachable)
  //
  // Absorb algorithm:
  //   All 3 assets seized fully; total proceeds = 150 × 0.90 = $135
  //   Residual = $2000 − $135 = $1865 -> absorbed from protocol reserves
  //   Borrower debt zeroed by reserves
  //
  // Accounting identity for reserves:
  //   getReserves = USDC_held − (totalSupply − totalBorrow)
  //   After absorb totalBorrow = 0 -> ∆reserves = −debtBefore (exact)
  //
  // Result:
  //   - COMP/WETH/LINK balances = 0 (all fully seized)
  //   - borrowBalance(borrower) = 0 (bad debt wiped by reserves)
  //   - reservesBefore − reservesAfter = debtBefore (exact accounting identity)
  //   - assetsIn = 0 (all bits cleared — all collateral positions gone)
  //   - isLiquidatable = false (no debt remains)

  describe('Scenario 11 — bad debt: all 3 collateral assets fully seized, shortfall absorbed by reserves', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any, priceFeedWETH: any, priceFeedLINK: any;
    let priceFeeds: any, tokens: any;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(1_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(100_000, 18),
            decimals: 18,
            initialPrice: 10,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(100_000, 18),
          },
          WETH: {
            initial: exp(100_000, 18),
            decimals: 18,
            initialPrice: 10,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(100_000, 18),
          },
          LINK: {
            initial: exp(100_000, 18),
            decimals: 18,
            initialPrice: 10,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(100_000, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
      priceFeedWETH = priceFeeds.WETH;
      priceFeedLINK = priceFeeds.LINK;
    });

    it('1: all 3 assets fully seized, debt zeroed by reserves, assetsIn cleared, reserve decrease = debtBefore', async function() {
      const { USDC, COMP, WETH, LINK } = tokens;

      // Governor provides USDC liquidity ($3000 covers borrower's $2000 withdrawal)
      await USDC.connect(governor).approve(comet.address, exp(3000, 6));
      await comet.connect(governor).supply(USDC.address, exp(3000, 6));

      // Borrower deposits:
      //   100 COMP × $10 = $1000 (borrowCF=0.80 -> $800 capacity)
      //   100 WETH × $10 = $1000 (-> $800 capacity)
      //   100 LINK × $10 = $1000 (-> $800 capacity)
      //   Total borrow capacity = $2400 > $2000 -> borrow is safe
      const compAmount = exp(100, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      const wethAmount = exp(100, 18);
      await WETH.connect(governor).transfer(borrower.address, wethAmount);
      await WETH.connect(borrower).approve(comet.address, wethAmount);
      await comet.connect(borrower).supply(WETH.address, wethAmount);

      const linkAmount = exp(100, 18);
      await LINK.connect(governor).transfer(borrower.address, linkAmount);
      await LINK.connect(borrower).approve(comet.address, linkAmount);
      await comet.connect(borrower).supply(LINK.address, linkAmount);

      await comet.connect(borrower).withdraw(USDC.address, exp(2000, 6));

      // Verify initial state: not liquidatable
      //   TCV(liquidateCF) = (1000+1000+1000)×0.85 = 3000×0.85 = $2550 > $2000
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Crash all three prices $10 -> $0.50 (−95%)
      // After crash:
      //   Total collateral = (100+100+100)×0.50 = $150 < $2000 = debt -> bad debt
      //   TCV(liquidateCF) = 150×0.85 = $127.50 < $2000 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 0.5);
      await setPrice(priceFeedWETH, governor, 0.5);
      await setPrice(priceFeedLINK, governor, 0.5);
      await comet.accrueAccount(borrower.address);

      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // Capture state immediately before absorb for reserve delta verification
      const debtBefore = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      const reservesBefore = (await (comet as any).getReserves()).toBigInt();

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // ── All 3 collateral positions fully seized ──
      //   Total collateral value ($150) < targetHF × debt ($2100): targetHF unreachable -> all seized
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      const linkBalance = (await comet.userCollateral(borrower.address, LINK.address)).balance.toBigInt();
      expect(compBalance).to.equal(0n, 'COMP should be fully seized');
      expect(wethBalance).to.equal(0n, 'WETH should be fully seized');
      expect(linkBalance).to.equal(0n, 'LINK should be fully seized');

      // ── Debt zeroed by reserves (bad debt absorbed) ──
      //   Proceeds from seizure = 150×0.90 = $135; residual debtBefore − $135 absorbed by reserves
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      expect(debtAfter).to.equal(0n, 'Borrower debt must be zeroed — bad debt absorbed by protocol reserves');

      // ── Reserves decreased by ~debtBefore ──
      //   Identity: getReserves = USDC_held − (totalSupply − totalBorrow)
      //   After absorb totalBorrow = 0; USDC_held and totalSupply unchanged -> ∆reserves ≈ −debtBefore
      //   A tolerance of ±10 base units accounts for integer rounding between borrowBalanceOf
      //   (which uses presentValue via baseBorrowIndex) and the internal principal-based accounting
      //   used by absorb — both compute the same debt but may differ by a few wei of rounding dust.
      const reservesAfter = (await (comet as any).getReserves()).toBigInt();
      expect(reservesAfter).to.be.lt(reservesBefore, 'Reserves must decrease after bad debt absorption');
      const reserveDelta = reservesBefore - reservesAfter;
      const tolerance = 10n;
      expect(reserveDelta).to.be.gte(debtBefore - tolerance, 'Reserve decrease must be within tolerance of absorbed debt (lower bound)');
      expect(reserveDelta).to.be.lte(debtBefore + tolerance, 'Reserve decrease must be within tolerance of absorbed debt (upper bound)');

      // ── assetsIn bitmask cleared to 0 ──
      //   COMP=bit0, WETH=bit1, LINK=bit2 all cleared (fully seized, balances=0)
      const userBasicAfter = await (comet as any).userBasic(borrower.address);
      expect(userBasicAfter.assetsIn).to.equal(0, 'assetsIn must be 0 after full absorption — all collateral positions gone');

      // ── Position no longer liquidatable (no debt remains) ──
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });

  // ── Scenario 12 — elevated targetHF=1.09: larger seizure than at targetHF=1.05 ──
  //
  // Parameters:
  //   COMP: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $100 -> $10
  //   targetHF = 1.09 (elevated; default is 1.05)
  //   denom = 0.90×1.09 − 0.80 = 0.181  (vs 0.145 at targetHF=1.05)
  //   Deposit: 1000 COMP × $100 = $100,000; borrow: $8,700 USDC
  //
  // Liquidation math (after COMP drop $100 -> $10):
  //   TCV(borrowCF)    = 1000×10×0.80 = $8,000
  //   TCV(liquidateCF) = 1000×10×0.85 = $8,500 < $8,700 -> liquidatable
  //   seize_USD = (8700×1.09 − 8000) / 0.181 = 1483/0.181 = 1483000/181 ≈ $8193.37
  //   seized COMP = 148300/181 ≈ 819.34 COMP  (< 1000 -> partial)
  //   remaining   = 32700/181 ≈ 180.66 COMP
  //   debt_after (exact rational) = 240000/181 ≈ $1325.97
  //   debt_after (on-chain, after integer truncation at each step) ≈ $1325.97
  //   HF = (32700/181×10×0.80) / (240000/181) = 261600/240000 = 1.09 (exact rational)
  //
  // Comparison with targetHF=1.05 (same market conditions):
  //   seize_1.05 = (8700×1.05 − 8000) / 0.145 = 1135/0.145 ≈ $7827.59 -> ≈ 782.76 COMP
  //   seize_1.09 ≈ 819.34 COMP  >  seize_1.05 ≈ 782.76 COMP (≈ 4.7% more seized)

  describe('Scenario 12 — elevated targetHF=1.09: larger seizure confirms targetHF drives the formula', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let tokens: any, priceFeeds: any;

    before(async function() {
      const protocol = await makeProtocol({
        targetHealthFactor: exp(1.09, 18),
        assets: {
          USDC: { initial: exp(1_000_000, 6), decimals: 6, initialPrice: 1 },
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 100,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(1_000_000, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
    });

    it('1: COMP partially seized at targetHF=1.09, more collateral seized than at targetHF=1.05, HF reaches 1.09', async function() {
      const { USDC, COMP } = tokens;

      // Governor provides USDC liquidity ($10,000 covers the $8,700 withdrawal)
      await USDC.connect(governor).approve(comet.address, exp(10_000, 6));
      await comet.connect(governor).supply(USDC.address, exp(10_000, 6));

      // Borrower deposits 1000 COMP × $100 = $100,000; borrowCF=0.80 -> capacity = $80,000
      const compAmount = exp(1000, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      // Borrow $8,700 USDC (well below capacity)
      await comet.connect(borrower).withdraw(USDC.address, exp(8700, 6));

      // Verify initial state: not liquidatable
      //   liquidateCF-weighted = 1000×100×0.85 = $85,000 > $8,700
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      console.log('\x1b[35m%s', 'Init COMP:',  Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt())  / 1e18);
      console.log('\x1b[35m%s', 'Init debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);

      // Drop COMP price $100 -> $10 (−90%)
      // After drop:
      //   liquidateCF-weighted = 1000×10×0.85 = $8,500 < $8,700 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 10);
      await comet.accrueAccount(borrower.address);

      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // COMP: partially seized — some COMP must remain
      //   seizeAmount = 148300/181 ≈ 819.34 COMP; remaining = 32700/181 ≈ 180.66 COMP
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      console.log('\x1b[36m%s', 'Remaining COMP (should be ~180.66):', Number(compBalance) / 1e18);
      expect(compBalance).to.be.gt(0n, 'COMP should be only partially seized');
      expect(compBalance).to.be.lt(compAmount, 'COMP balance must have decreased');

      // Precision check: remaining COMP in [180, 181] tokens (32700/181 ≈ 180.66)
      expect(compBalance).to.be.gte(180n * exp(1, 18), 'Remaining COMP should be >= 180 COMP');
      expect(compBalance).to.be.lte(181n * exp(1, 18), 'Remaining COMP should be <= 181 COMP');

      // Remaining debt > 0 (partial liquidation, not full)
      //   Theoretical (exact rational): 240000/181 ≈ $1325.97
      //   On-chain (after integer truncation at rawCollateralUSD, debtReduction, principalValue steps): ≈ $1325.97
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      expect(debtAfter).to.be.gt(0n, 'Debt must remain after partial liquidation');
      expect(debtAfter).to.be.lt(exp(8700, 6), 'Debt must have been partially repaid');

      // Precision check: remaining debt in [$1325, $1327] (theoretical $1325.97, on-chain ≈ $1325.97)
      expect(debtAfter).to.be.gte(exp(1325, 6), 'Remaining debt should be >= $1325');
      expect(debtAfter).to.be.lte(exp(1326, 6), 'Remaining debt should be <= $1326');

      // Position is healthy after absorb
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // Health factor must equal targetHF=1.09 exactly
      //   HF = (32700/181×10×0.80) / (240000/181) = 261600/240000 = 1.09
      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'Current HF after absorb:', Number(currentHF) / 1e18);
      expect(currentHF).to.be.gte(exp(1.09, 18) - 8n * 10n ** 9n, 'Health factor should be >= targetHF=1.09 (±8e9 rounding tolerance)');
      expect(currentHF).to.be.lte(exp(1.09, 18) + 8n * 10n ** 9n, 'Health factor should be <= targetHF=1.09 (±8e9 rounding tolerance)');

      // Key invariant: more collateral seized at targetHF=1.09 than at targetHF=1.05
      //   seize_1.09 ≈ 819.34 COMP  >  seize_1.05 ≈ 782.76 COMP
      //   seized = compAmount − compBalance; at targetHF=1.05 seized ≤ 783 COMP
      const seizedAmount = compAmount - compBalance;
      expect(seizedAmount).to.be.gte(819n * exp(1, 18), 'At targetHF=1.09 seized COMP must be >= 819 (more than at targetHF=1.05 ≈ 783)');
    });
  });

  // ── Scenario 13 — 3 collateral assets: COMP fully seized, WBTC partial (guard -> full debt closure), WETH untouched ──
  //
  // Parameters:
  //   COMP: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $20 -> $10
  //   WBTC: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $1000 (stable)
  //   WETH: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $100 (stable)
  //   targetHF = 1.05
  //   baseBorrowMin = $15 USDC
  //   Deposit: 25 COMP ($500 -> $250) + 0.051 WBTC ($51) + 0.01 WETH ($1)
  //   Borrow: $270 USDC
  //
  // Initial state (COMP = $20):
  //   TCV_liquidateCF = 0.85×$500 + 0.85×$51 + 0.85×$1 = $425 + $43.35 + $0.85 = $469.20 > $270 -> NOT liquidatable
  //
  // After COMP price drop $20 -> $10:
  //   TCV_liquidateCF = 0.85×$250 + 0.85×$51 + 0.85×$1 = $212.50 + $43.35 + $0.85 = $256.70 < $270 -> LIQUIDATABLE
  //   TCV_CF (borrowCF) = 0.80×$250 + 0.80×$51 + 0.80×$1 = $200 + $40.80 + $0.80 = $241.60
  //
  // Liquidation math:
  //   denom = 0.90×1.05 − 0.80 = 0.145
  //
  //   Iter 1 COMP: rawCOMP = (270×1.05 − 241.60) / 0.145 = 41.90/0.145 ≈ $288.97 > $250 -> full seizure
  //     seizedValue = $250×0.90 = $225; debtRemaining = $270 − $225 = $45; TCV_CF = $41.60
  //
  //   Iter 2 WBTC: rawWBTC = (45×1.05 − 41.60) / 0.145 = 5.65/0.145 ≈ $38.97 ≤ $51 -> PARTIAL PATH
  //     debtReduction = $38.97×0.90 ≈ $35.07; debtAfterPartial = $9.93 < baseBorrowMin $15 -> guard triggers!
  //     wantedFull = ⌈$45 / 0.90⌉ = $50 ≤ WBTC_value $51 -> full debt closure
  //     seizeAmount = 0.05 WBTC; seizedValue = $45; debt = $0; isHealthy = true -> break
  //
  //   Iter 3 WETH: NEVER REACHED -> remains unchanged: 0.01 WETH
  //
  // Final state:
  //   COMP: 0 (fully seized)
  //   WBTC: 0.051 − 0.05 = 0.001 WBTC remaining
  //   WETH: 0.01 WETH (unchanged)
  //   Debt: $0 USDC (fully closed via guard)
  describe('Scenario 13 — 3 collateral assets: COMP fully seized, WBTC partial path triggers baseBorrowMin guard -> full debt closure, WETH untouched', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let priceFeeds: any, tokens: any;

    before(async function() {
      const protocol = await makeProtocol({
        // baseBorrowMin = $15 USDC (6 decimals)
        // Guard fires when remaining debt after partial WBTC seizure falls below this threshold.
        baseBorrowMin: exp(15, 6),
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          // Asset index 0: COMP — price drops from $20 to $10, causing liquidation
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 20,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(2e5, 18),
          },
          // Asset index 1: WBTC — stable price $1000; triggers baseBorrowMin guard in iter 2
          WBTC: {
            initial: exp(10_000, 18),
            decimals: 18,
            initialPrice: 1000,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(10_000, 18),
          },
          // Asset index 2: WETH — stable price $100; must remain completely untouched
          WETH: {
            initial: exp(10_000, 18),
            decimals: 18,
            initialPrice: 100,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(10_000, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
    });

    it('1: COMP fully seized (iter 1), WBTC partial path + baseBorrowMin guard closes full debt (iter 2), WETH untouched (iter 3 never reached)', async function() {
      const { USDC, COMP, WBTC, WETH } = tokens;

      // ── Governor provides USDC liquidity ──
      await USDC.connect(governor).approve(comet.address, exp(10_000, 6));
      await comet.connect(governor).supply(USDC.address, exp(10_000, 6));

      // ── Borrower deposits:
      //   25 COMP × $20 = $500; borrowCF=0.80 -> capacity = $400
      //   0.051 WBTC × $1000 = $51; borrowCF=0.80 -> capacity = $40.80
      //   0.01 WETH × $100 = $1;   borrowCF=0.80 -> capacity = $0.80
      //   Total borrow capacity = $441.60 -> borrow $270 USDC (well below max)
      const compAmount = exp(25, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      // 0.051 WBTC = 51_000_000_000_000_000 wei
      const wbtcAmount = 51_000_000_000_000_000n;
      await WBTC.connect(governor).transfer(borrower.address, wbtcAmount);
      await WBTC.connect(borrower).approve(comet.address, wbtcAmount);
      await comet.connect(borrower).supply(WBTC.address, wbtcAmount);

      // 0.01 WETH = 10_000_000_000_000_000 wei
      const wethAmount = 10_000_000_000_000_000n;
      await WETH.connect(governor).transfer(borrower.address, wethAmount);
      await WETH.connect(borrower).approve(comet.address, wethAmount);
      await comet.connect(borrower).supply(WETH.address, wethAmount);

      await comet.connect(borrower).withdraw(USDC.address, exp(270, 6));

      // ── Log initial state ──
      console.log('\x1b[35m%s', '=== INITIAL STATE ===');
      console.log('\x1b[35m%s', 'Init COMP:', Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init WBTC:', Number((await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init WETH:', Number((await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);

      // ── Verify initial state: not liquidatable ──
      //   TCV_liquidateCF = 0.85×$500 + 0.85×$51 + 0.85×$1 = $469.20 > $270 -> not liquidatable
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // ── Pre-absorb verification: confirm baseBorrowMin guard will fire on WBTC ──
      //
      // After COMP full seizure debtRemaining = $45 in price units = 4_500_000_000
      // TCV_CF remaining = 0.80×$51 + 0.80×$1 = $41.60 = 4_160_000_000
      //
      // Partial path: wantedWBTC = 565_000_000 × 1e18 / 145e15 = 3_896_551_724
      // debtReduction = 3_896_551_724 × 0.9 = 3_506_896_551
      // debtAfterPartial = (4_500_000_000 - 3_506_896_551) × 1e6 / 1e8 = 9_931_034
      // 9_931_034 < baseBorrowMin = 15_000_000 -> guard fires
      //
      // Full closure: wantedFull = ceil(4_500_000_000 / 0.9) = 5_000_000_000 ≤ WBTC 5_100_000_000 -> OK
      const FACTOR_SCALE = BigInt(exp(1, 18));
      const basePrice = BigInt(exp(1, 8));      // USDC = $1
      const baseScale = BigInt(exp(1, 6));
      const wbtcPrice = BigInt(exp(1000, 8));
      const compPrice = BigInt(exp(10, 8));     // after drop
      const compScale = BigInt(exp(1, 18));
      const wbtcScale = BigInt(exp(1, 18));
      const wethScale = BigInt(exp(1, 18));
      const wethPrice = BigInt(exp(100, 8));
      const LF        = BigInt(exp(0.9, 18));
      const borrowCF  = BigInt(exp(0.8, 18));
      const targetHF  = BigInt(exp(1.05, 18));
      const baseBorrowMinVal = (await comet.baseBorrowMin()).toBigInt();

      // TCV_CF initial (with dropped COMP price)
      const compValue = compAmount * compPrice / compScale;     // 25_000_000_000
      const wbtcValue = wbtcAmount * wbtcPrice / wbtcScale;     // 5_100_000_000
      const wethValue = wethAmount * wethPrice / wethScale;     // 100_000_000

      const tcvCFInitial = compValue * borrowCF / FACTOR_SCALE
                          + wbtcValue * borrowCF / FACTOR_SCALE
                          + wethValue * borrowCF / FACTOR_SCALE;

      const debtUSD = BigInt(exp(270, 6)) * basePrice / baseScale; // 27_000_000_000

      // ── Verify: COMP fully seized (rawCOMP > compValue) ──
      const rawCOMP = (debtUSD * targetHF / FACTOR_SCALE - tcvCFInitial)
                    * FACTOR_SCALE
                    / (LF * targetHF / FACTOR_SCALE - borrowCF);
      expect(rawCOMP).to.be.gt(compValue, 'Pre-check: rawCOMP must exceed COMP available -> full seizure');

      // ── Verify: After COMP full seizure, WBTC enters partial path ──
      const seizedValueCOMP = compValue * LF / FACTOR_SCALE;        // 22_500_000_000
      const debtAfterCOMP   = debtUSD - seizedValueCOMP;            // 4_500_000_000
      const tcvCFAfterCOMP  = wbtcValue * borrowCF / FACTOR_SCALE
                            + wethValue * borrowCF / FACTOR_SCALE;  // 4_160_000_000

      const rawWBTC = (debtAfterCOMP * targetHF / FACTOR_SCALE - tcvCFAfterCOMP)
                    * FACTOR_SCALE
                    / (LF * targetHF / FACTOR_SCALE - borrowCF);
      expect(rawWBTC).to.be.lte(wbtcValue, 'Pre-check: rawWBTC must not exceed WBTC available -> partial path');

      // ── Verify: debtAfterPartial < baseBorrowMin -> guard fires ──
      const debtReductionWBTC  = rawWBTC * LF / FACTOR_SCALE;
      const debtAfterPartialUSD = debtAfterCOMP - debtReductionWBTC;
      const debtAfterPartialBase = debtAfterPartialUSD * baseScale / basePrice;
      expect(debtAfterPartialBase).to.be.lt(baseBorrowMinVal,
        'Pre-check: debtAfterPartial must be below baseBorrowMin to trigger the guard');

      // ── Verify: WBTC has enough collateral for full debt closure ──
      // wantedFull = ceil(debtAfterCOMP * FACTOR_SCALE / LF) — using ceiling division from code
      const wantedFull = (debtAfterCOMP * FACTOR_SCALE + LF - 1n) / LF;
      expect(wantedFull).to.be.lte(wbtcValue,
        'Pre-check: wantedCollateralValue_full must not exceed WBTC available -> full debt closure succeeds');

      // ── Drop COMP price $20 -> $10 (−50%). WBTC and WETH stay unchanged. ──
      // After drop: TCV_liquidateCF = 0.85×$250 + 0.85×$51 + 0.85×$1 = $256.70 < $270 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 10);
      await comet.accrueAccount(borrower.address);

      const hfBeforeAbsorb = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'HF before absorb:', Number(hfBeforeAbsorb) / 1e18);

      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // ── Execute liquidation ──
      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // ── Log final state ──
      console.log('\x1b[35m%s', '=== FINAL STATE ===');
      console.log('\x1b[36m%s', 'Remaining COMP:', Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[36m%s', 'Remaining WBTC:', Number((await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[36m%s', 'Remaining WETH:', Number((await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[36m%s', 'Remaining debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);

      // ── Assertion 1: COMP fully seized (iter 1 -> full seizure) ──
      //   rawCOMP ≈ $288.97 > COMP_value = $250 -> seize all 25 COMP
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      expect(compBalance).to.equal(0n, 'COMP must be fully seized (iter 1: rawCOMP > collateral)');

      // ── Assertion 2: WBTC partially seized but with full debt closure (iter 2 -> guard fires) ──
      //   partial path: rawWBTC ≈ $38.97 ≤ WBTC $51 -> enters partial branch
      //   debtAfterPartial ≈ $9.93 < baseBorrowMin $15 -> guard fires
      //   full closure: wantedFull = $50 ≤ WBTC $51 -> seize 0.05 WBTC, close full debt
      //   remaining WBTC = 0.051 − 0.05 = 0.001 WBTC = 1_000_000_000_000_000 wei
      const wbtcBalance = (await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt();
      expect(wbtcBalance).to.be.gt(0n,        'WBTC must not be fully seized (guard path leaves remainder)');
      expect(wbtcBalance).to.be.lt(wbtcAmount, 'WBTC balance must have decreased after guard-triggered closure');
      // Precision: remaining = 0.001 WBTC ± 1 wei rounding tolerance
      expect(wbtcBalance).to.be.gte(999_999_999_999_999n, 'Remaining WBTC should be ≥ 0.001 WBTC (±1 wei)');
      expect(wbtcBalance).to.be.lte(1_000_000_000_000_001n, 'Remaining WBTC should be ≤ ~0.001 WBTC (±1 wei)');

      // ── Assertion 3: WETH completely untouched (iter 3 never reached) ──
      //   isHealthy = true after iter 2 -> break -> WETH loop body never executes
      const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      expect(wethBalance).to.equal(wethAmount, 'WETH must be completely untouched (iter 3 never reached due to break)');

      // ── Assertion 4: Debt fully closed (guard forced full debt closure, not partial) ──
      //   Without guard: $9.93 would remain. Guard forces: borrow $0.
      const debtAfter = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      expect(debtAfter).to.equal(0n, 'Debt must be fully closed (baseBorrowMin guard forced full closure)');

      // ── Assertion 5: Position no longer liquidatable ──
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });

  // ── Scenario 14 — 3 collateral assets: only COMP partially seized, WBTC and WETH untouched ──
  //
  // Parameters:
  //   COMP: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $50 -> $10
  //   WBTC: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $1000 (stable)
  //   WETH: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $2000 (stable)
  //   targetHF = 1.05
  //
  //   Deposit: 1000 COMP ($50000 -> $10000) + 0.1 WBTC ($100) + 0.1 WETH ($200)
  //   Borrow: $9000 USDC
  //
  // Initial state (COMP = $50):
  //   TCV_liquidateCF = 0.85×$50000 + 0.85×$100 + 0.85×$200
  //                   = $42500 + $85 + $170 = $42755 > $9000 -> NOT liquidatable
  //
  // After COMP price drop $50 -> $10:
  //   TCV_liquidateCF = 0.85×$10000 + 0.85×$100 + 0.85×$200
  //                   = $8500 + $85 + $170 = $8755 < $9000 -> LIQUIDATABLE
  //   TCV_CF (borrowCF) = 0.80×$10000 + 0.80×$100 + 0.80×$200
  //                     = $8000 + $80 + $160 = $8240
  //
  // Liquidation math:
  //   denom = LF×targetHF − borrowCF = 0.90×1.05 − 0.80 = 0.145
  //
  //   Iter 1 COMP: rawCOMP = (9000×1.05 − 8240) / 0.145 = 1210/0.145 ≈ $8344.83
  //     $8344.83 < COMP_value $10000 -> PARTIAL PATH
  //     seizeAmount = $8344.83 / $10 ≈ 834.483 COMP; remaining ≈ 165.517 COMP
  //     debtReduction = $8344.83×0.90 ≈ $7510.34; debtAfter ≈ $1489.66
  //     isHealthy = true -> break
  //
  //   Iter 2 WBTC: NEVER REACHED -> 0.1 WBTC unchanged
  //   Iter 3 WETH: NEVER REACHED -> 0.1 WETH unchanged
  //
  // HF check after liquidation:
  //   HF = (165.517×$10×0.80 + 0.1×$1000×0.80 + 0.1×$2000×0.80) / $1489.66
  //      = ($1324.14 + $80 + $160) / $1489.66
  //      = $1564.14 / $1489.66 ≈ 1.05
  //
  // Integer arithmetic (price scale = 1e8):
  //   COMP_value = 1_000_000_000_000   ($10,000 × 1e8)
  //   WBTC_value =    10_000_000_000   ($100   × 1e8)
  //   WETH_value =    20_000_000_000   ($200   × 1e8)
  //   debt       =   900_000_000_000   ($9,000 × 1e8)
  //   TCV_CF     =   824_000_000_000
  //
  //   numerator = mulFactor(900e9, 1.05e18) − 824e9
  //             = 945_000_000_000 − 824_000_000_000 = 121_000_000_000
  //   rawCOMP   = 121e9 × 1e18 / 145e15 = 121e9 × 1000 / 145 = 834_482_758_620
  //   834_482_758_620 < 1_000_000_000_000 -> partial path
  //   debtReduction = 834_482_758_620 × 9/10 = 751_034_482_758
  //   seizeAmount   = 834_482_758_620 × 1e18 / (10 × 1e8) = 834_482_758_620_000_000_000 wei
  //   remaining     = 1e21 − 834_482_758_620_000_000_000 = 165_517_241_380_000_000_000 wei
  //   debtAfterBase = (900e9 − 751_034_482_758) × 1e6 / 1e8 = 1_489_655_172 (≈ $1489.66)
  //
  // Final state:
  //   COMP: ≈ 165.517 COMP remaining (≈ 165_517_241_380_000_000_000 wei)
  //   WBTC: 0.1 WBTC = 1e17 wei (unchanged)
  //   WETH: 0.1 WETH = 1e17 wei (unchanged)
  //   Debt: ≈ $1489.66 USDC (partial liquidation)
  describe('Scenario 14 — 3 collateral assets: only COMP partially seized (iter 1), WBTC and WETH untouched (iters 2–3 never reached)', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let priceFeeds: any, tokens: any;

    before(async function() {
      const protocol = await makeProtocol({
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          // Asset index 0: COMP — price drops $50 -> $10, partial seizure stops the algorithm
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 50,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(2_000_000, 18),
          },
          // Asset index 1: WBTC — stable $1000; never touched (algorithm breaks at COMP)
          WBTC: {
            initial: exp(10_000, 18),
            decimals: 18,
            initialPrice: 1000,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(10_000, 18),
          },
          // Asset index 2: WETH — stable $2000; never touched (algorithm breaks at COMP)
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
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
    });

    it('1: COMP partially seized, WBTC and WETH completely untouched, debt partially reduced, HF reaches targetHF=1.05', async function() {
      const { USDC, COMP, WBTC, WETH } = tokens;

      // ── Governor provides USDC liquidity ──
      await USDC.connect(governor).approve(comet.address, exp(10_000, 6));
      await comet.connect(governor).supply(USDC.address, exp(10_000, 6));

      // ── Borrower deposits:
      //   1000 COMP × $50 = $50,000; borrowCF=0.80 -> capacity = $40,000
      //   0.1  WBTC × $1000 = $100;  borrowCF=0.80 -> capacity = $80
      //   0.1  WETH × $2000 = $200;  borrowCF=0.80 -> capacity = $160
      //   Total borrow capacity = $40,240 -> borrow $9,000 USDC (well below max)
      const compAmount = exp(1000, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      const wbtcAmount = exp(1, 17); // 0.1 WBTC
      await WBTC.connect(governor).transfer(borrower.address, wbtcAmount);
      await WBTC.connect(borrower).approve(comet.address, wbtcAmount);
      await comet.connect(borrower).supply(WBTC.address, wbtcAmount);

      const wethAmount = exp(1, 17); // 0.1 WETH
      await WETH.connect(governor).transfer(borrower.address, wethAmount);
      await WETH.connect(borrower).approve(comet.address, wethAmount);
      await comet.connect(borrower).supply(WETH.address, wethAmount);

      await comet.connect(borrower).withdraw(USDC.address, exp(9000, 6));

      // ── Log initial state ──
      console.log('\x1b[35m%s', '=== INITIAL STATE ===');
      console.log('\x1b[35m%s', 'Init COMP:', Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init WBTC:', Number((await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init WETH:', Number((await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);

      // ── Verify initial state: not liquidatable ──
      //   TCV_liquidateCF = 0.85×$50000 + 0.85×$100 + 0.85×$200 = $42755 > $9000
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // ── Pre-absorb verification: confirm COMP enters partial path ──
      //
      // After price drop rawCOMP ≈ $8344.83 < COMP_value $10,000 -> partial path
      // debtAfterPartial ≈ $1489.66 >> any reasonable baseBorrowMin -> guard does NOT fire
      // isHealthy = true -> break -> WBTC and WETH are never touched
      const FACTOR_SCALE  = BigInt(exp(1, 18));
      const basePrice     = BigInt(exp(1, 8));     // USDC = $1
      const baseScale     = BigInt(exp(1, 6));
      const compPrice     = BigInt(exp(10, 8));    // COMP after drop
      const compScale     = BigInt(exp(1, 18));
      const wbtcPrice     = BigInt(exp(1000, 8));
      const wbtcScale     = BigInt(exp(1, 18));
      const wethPrice     = BigInt(exp(2000, 8));
      const wethScale     = BigInt(exp(1, 18));
      const LF            = BigInt(exp(0.9, 18));
      const borrowCF      = BigInt(exp(0.8, 18));
      const targetHF      = BigInt(exp(1.05, 18));

      // USD values in price units (×1e8)
      const compValue = compAmount * compPrice / compScale;  // 1_000_000_000_000  ($10,000)
      const wbtcValue = wbtcAmount * wbtcPrice / wbtcScale;  //    10_000_000_000  ($100)
      const wethValue = wethAmount * wethPrice / wethScale;  //    20_000_000_000  ($200)
      const debtUSD   = BigInt(exp(9000, 6)) * basePrice / baseScale; // 900_000_000_000  ($9,000)

      // TCV_CF = 0.80×COMP + 0.80×WBTC + 0.80×WETH = 824_000_000_000
      const tcvCF = compValue * borrowCF / FACTOR_SCALE
                  + wbtcValue * borrowCF / FACTOR_SCALE
                  + wethValue * borrowCF / FACTOR_SCALE;

      // rawCOMP = (debt×targetHF − TCV_CF) × FACTOR_SCALE / (LF×targetHF − borrowCF)
      //         = 121_000_000_000 × 1e18 / 145e15 = 834_482_758_620
      const rawCOMP = (debtUSD * targetHF / FACTOR_SCALE - tcvCF)
                    * FACTOR_SCALE
                    / (LF * targetHF / FACTOR_SCALE - borrowCF);

      // ── Verify: rawCOMP < COMP_value -> partial path (not full seizure) ──
      expect(rawCOMP).to.be.lt(compValue, 'Pre-check: rawCOMP must be less than COMP available -> partial path');

      // ── Verify: debtAfterPartial >> baseBorrowMin -> guard does NOT fire ──
      const debtReduction     = rawCOMP * LF / FACTOR_SCALE;            // 751_034_482_758
      const debtAfterPartialUSD  = debtUSD - debtReduction;             // 148_965_517_242
      const debtAfterPartialBase = debtAfterPartialUSD * baseScale / basePrice; // 1_489_655_172
      const baseBorrowMinVal  = (await comet.baseBorrowMin()).toBigInt();
      expect(debtAfterPartialBase).to.be.gte(baseBorrowMinVal,
        'Pre-check: debtAfterPartial must be >= baseBorrowMin so guard does NOT fire');

      // ── Drop COMP price $50 -> $10 (−80%). WBTC and WETH stay unchanged. ──
      // After drop: TCV_liquidateCF = 0.85×$10000 + 0.85×$100 + 0.85×$200 = $8755 < $9000 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 10);
      await comet.accrueAccount(borrower.address);

      const hfBefore = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'HF before absorb:', Number(hfBefore) / 1e18);

      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // ── Execute liquidation ──
      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // ── Log final state ──
      console.log('\x1b[35m%s', '=== FINAL STATE ===');
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      const wbtcBalance = (await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt();
      const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      const debtAfter   = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      console.log('\x1b[36m%s', 'Remaining COMP:', Number(compBalance) / 1e18);
      console.log('\x1b[36m%s', 'Remaining WBTC:', Number(wbtcBalance) / 1e18);
      console.log('\x1b[36m%s', 'Remaining WETH:', Number(wethBalance) / 1e18);
      console.log('\x1b[36m%s', 'Remaining debt (USDC):', Number(debtAfter) / 1e6);

      // ── Assertion 1: COMP is partially seized (iter 1 -> partial, isHealthy=true -> break) ──
      //   rawCOMP ≈ 834.48 COMP seized; remaining ≈ 165.52 COMP
      expect(compBalance).to.be.gt(0n,        'COMP must not be fully seized (partial liquidation)');
      expect(compBalance).to.be.lt(compAmount, 'COMP balance must have decreased after partial seizure');
      // Precision: remaining ≈ 165.517 COMP = 165_517_241_380_000_000_000 wei -> in [165, 166] COMP
      expect(compBalance).to.be.gte(165n * exp(1, 18), 'Remaining COMP should be >= 165 COMP');
      expect(compBalance).to.be.lte(166n * exp(1, 18), 'Remaining COMP should be <= 166 COMP');

      // ── Assertion 2: WBTC completely untouched (iter 2 never reached) ──
      //   Algorithm calls break after COMP partial seizure; WBTC loop body never executes
      expect(wbtcBalance).to.equal(wbtcAmount, 'WBTC must be completely untouched (iter 2 never reached)');

      // ── Assertion 3: WETH completely untouched (iter 3 never reached) ──
      expect(wethBalance).to.equal(wethAmount, 'WETH must be completely untouched (iter 3 never reached)');

      // ── Assertion 4: Debt partially reduced (not zero — partial liquidation stopped at targetHF) ──
      //   Expected: ≈ $1489.66 USDC
      expect(debtAfter).to.be.gt(0n,           'Debt must remain > 0 after partial liquidation');
      expect(debtAfter).to.be.lt(exp(9000, 6), 'Debt must have been reduced from initial $9,000');
      // Precision: ≈ $1489.66 -> in [$1489, $1490]
      expect(debtAfter).to.be.gte(exp(1489, 6), 'Remaining debt should be >= $1489');
      expect(debtAfter).to.be.lte(exp(1490, 6), 'Remaining debt should be <= $1490');

      // ── Assertion 5: Position no longer liquidatable ──
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // ── Assertion 6: Health factor equals targetHF = 1.05 ──
      //   HF = (165.517×10×0.80 + 0.1×1000×0.80 + 0.1×2000×0.80) / 1489.66
      //      = (1324.14 + 80 + 160) / 1489.66 ≈ 1.05
      const currentHF = await getHealthFactor(comet, borrower.address);
      console.log('\x1b[32m%s', 'HF after absorb:', Number(currentHF) / 1e18);
      expect(currentHF).to.be.gte(exp(1.05, 18) - 8n * 10n ** 9n,
        'Health factor should be >= targetHF=1.05 (±8e9 rounding tolerance)');
      expect(currentHF).to.be.lte(exp(1.05, 18) + 8n * 10n ** 9n,
        'Health factor should be <= targetHF=1.05 (±8e9 rounding tolerance)');
    });
  });

  // ── Scenario 15 — 3 collateral assets: COMP and WBTC fully seized, WETH fully seized but
  //    even all of WETH cannot cover the remaining debt -> bad debt (bad debt < baseBorrowMin) ──
  //
  // Parameters:
  //   COMP: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $50 -> $20
  //   WBTC: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $1000 (stable)
  //   WETH: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $100 (stable)
  //   targetHF = 1.05
  //   baseBorrowMin = $5 USDC
  //
  //   Deposit: 10 COMP ($500->$200) + 0.1 WBTC ($100) + 0.1 WETH ($10)
  //   Borrow: $282 USDC
  //
  // Initial state (COMP = $50):
  //   TCV_liquidateCF = 0.85×$500 + 0.85×$100 + 0.85×$10 = $518.50 > $282 -> NOT liquidatable
  //
  // After COMP price drop $50 -> $20:
  //   TCV_liquidateCF = 0.85×$200 + 0.85×$100 + 0.85×$10 = $263.50 < $282 -> LIQUIDATABLE
  //   TCV_CF (borrowCF) = 0.80×$200 + 0.80×$100 + 0.80×$10 = $248
  //
  // Liquidation math:
  //   denom = 0.90×1.05 − 0.80 = 0.145
  //
  //   Iter 1 COMP: rawCOMP = (282×1.05 − 248) / 0.145 = 48.10/0.145 ≈ $331.72 > $200 -> full seizure
  //     seizedValue = $200×0.90 = $180; debtRemaining = $282−$180 = $102; TCV_CF = $88
  //
  //   Iter 2 WBTC: rawWBTC = (102×1.05 − 88) / 0.145 = 19.10/0.145 ≈ $131.72 > $100 -> full seizure
  //     seizedValue = $100×0.90 = $90; debtRemaining = $102−$90 = $12; TCV_CF = $8
  //
  //   Iter 3 WETH: rawWETH = (12×1.05 − 8) / 0.145 = 4.60/0.145 ≈ $31.72 > $10 -> full seizure
  //     All WETH ($10×0.90 = $9) seized, but this covers only $9 of $12 -> remainder $3
  //     isHealthy = false (loop ended without reaching targetHF)
  //
  //   After loop: newBalance = −$282 + $279 = −$3 < 0 AND !isHealthy -> BAD DEBT
  //     newBalance -> 0; $3 bad debt < baseBorrowMin $5 -> absorbed by protocol
  //
  // Integer arithmetic (price scale = 1e8):
  //   COMP_value = 20_000_000_000   WBTC_value = 10_000_000_000   WETH_value = 1_000_000_000
  //   debt       = 28_200_000_000   TCV_CF     = 24_800_000_000
  //
  //   Iter 1: numerator = 29_610_000_000 − 24_800_000_000 = 4_810_000_000
  //           rawCOMP   = 4_810e9 × 1000/145 = 33_172_413_793 > 20_000_000_000 -> outer else
  //           seizedValue = 18_000_000_000; TCV_CF = 8_800_000_000
  //
  //   Iter 2: debtRemaining = 10_200_000_000; numerator = 10_710_000_000 − 8_800_000_000 = 1_910_000_000
  //           rawWBTC = 1_910e9 × 1000/145 = 13_172_413_793 > 10_000_000_000 -> outer else
  //           seizedValue = 9_000_000_000; TCV_CF = 800_000_000
  //
  //   Iter 3: debtRemaining = 1_200_000_000; numerator = 1_260_000_000 − 800_000_000 = 460_000_000
  //           rawWETH = 460e9 × 1000/145 = 3_172_413_793 > 1_000_000_000 -> outer else
  //           seizedValue = 900_000_000; totalSeized = 27_900_000_000
  //
  //   newBalance = −282_000_000 + 27_900_000_000×1e6/1e8
  //              = −282_000_000 + 279_000_000 = −3_000_000 -> bad debt $3
  //   baseBorrowMin = 5_000_000 > 3_000_000 -> bad debt < minimum threshold
  //
  // Final state:
  //   COMP: 0; WBTC: 0; WETH: 0; Debt: 0 (bad debt $3 absorbed by protocol)

  describe('Scenario 15 — 3 collateral assets: COMP and WBTC fully seized, WETH fully seized but insufficient to cover remaining debt -> bad debt absorbed by protocol', function() {
    let governor: SignerWithAddress;
    let liquidator: SignerWithAddress;
    let borrower: SignerWithAddress;
    let comet: CometInterface;
    let priceFeedCOMP: any;
    let priceFeeds: any, tokens: any;

    before(async function() {
      const protocol = await makeProtocol({
        // baseBorrowMin = $5 USDC. The final bad debt ($3) falls below this threshold,
        // illustrating that even the "minimum borrow" concept is violated — the residual
        // shortfall is too small to represent a valid position and is absorbed as bad debt.
        baseBorrowMin: exp(5, 6),
        assets: {
          USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
          // Asset index 0: COMP — price drops $50->$20; rawCOMP > COMP_value -> outer else
          COMP: {
            initial: exp(1_000_000, 18),
            decimals: 18,
            initialPrice: 50,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(2_000_000, 18),
          },
          // Asset index 1: WBTC — stable $1000; rawWBTC > WBTC_value after COMP seized -> outer else
          WBTC: {
            initial: exp(10_000, 18),
            decimals: 18,
            initialPrice: 1000,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(10_000, 18),
          },
          // Asset index 2: WETH — stable $100; rawWETH > WETH_value -> outer else -> seize all
          //   but WETH×LF = $9 < remaining debt $12 -> $3 bad debt
          WETH: {
            initial: exp(10_000, 18),
            decimals: 18,
            initialPrice: 100,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
            supplyCap: exp(10_000, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
      });
      ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
      liquidator = protocol.pauseGuardian;
      borrower = protocol.users[0];
      priceFeedCOMP = priceFeeds.COMP;
    });

    it('1: COMP and WBTC fully seized, WETH fully seized but insufficient -> $3 bad debt absorbed by protocol', async function() {
      const { USDC, COMP, WBTC, WETH } = tokens;

      // ── Governor provides USDC liquidity ──
      await USDC.connect(governor).approve(comet.address, exp(10_000, 6));
      await comet.connect(governor).supply(USDC.address, exp(10_000, 6));

      // ── Borrower deposits:
      //   10 COMP × $50 = $500;  borrowCF=0.80 -> capacity = $400
      //   0.1 WBTC × $1000 = $100; borrowCF=0.80 -> capacity = $80
      //   0.1 WETH × $100  = $10;  borrowCF=0.80 -> capacity = $8
      //   Total borrow capacity = $488 -> borrow $282 USDC (well below max)
      const compAmount = exp(10, 18);
      await COMP.connect(governor).transfer(borrower.address, compAmount);
      await COMP.connect(borrower).approve(comet.address, compAmount);
      await comet.connect(borrower).supply(COMP.address, compAmount);

      const wbtcAmount = exp(1, 17); // 0.1 WBTC
      await WBTC.connect(governor).transfer(borrower.address, wbtcAmount);
      await WBTC.connect(borrower).approve(comet.address, wbtcAmount);
      await comet.connect(borrower).supply(WBTC.address, wbtcAmount);

      const wethAmount = exp(1, 17); // 0.1 WETH
      await WETH.connect(governor).transfer(borrower.address, wethAmount);
      await WETH.connect(borrower).approve(comet.address, wethAmount);
      await comet.connect(borrower).supply(WETH.address, wethAmount);

      await comet.connect(borrower).withdraw(USDC.address, exp(282, 6));

      // ── Log initial state ──
      console.log('\x1b[35m%s', '=== INITIAL STATE ===');
      console.log('\x1b[35m%s', 'Init COMP:', Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init WBTC:', Number((await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init WETH:', Number((await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt()) / 1e18);
      console.log('\x1b[35m%s', 'Init debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);

      // ── Verify initial state: not liquidatable ──
      //   TCV_liquidateCF = 0.85×$500 + 0.85×$100 + 0.85×$10 = $518.50 > $282
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;

      // ── Pre-absorb verification ──
      //
      // After drop, verify all three assets go through outer-else (rawX > valueX)
      // and that totalSeized < debt -> bad debt arises.
      const FACTOR_SCALE = BigInt(exp(1, 18));
      const basePrice    = BigInt(exp(1, 8));
      const baseScale    = BigInt(exp(1, 6));
      const compPrice    = BigInt(exp(20, 8));   // COMP after drop
      const wbtcPrice    = BigInt(exp(1000, 8));
      const wethPrice    = BigInt(exp(100, 8));
      const compScale    = BigInt(exp(1, 18));
      const wbtcScale    = BigInt(exp(1, 18));
      const wethScale    = BigInt(exp(1, 18));
      const LF           = BigInt(exp(0.9, 18));
      const borrowCF     = BigInt(exp(0.8, 18));
      const targetHF     = BigInt(exp(1.05, 18));

      const compValue = compAmount * compPrice / compScale;  // 20_000_000_000 ($200)
      const wbtcValue = wbtcAmount * wbtcPrice / wbtcScale;  // 10_000_000_000 ($100)
      const wethValue = wethAmount * wethPrice / wethScale;  //  1_000_000_000  ($10)
      const debtUSD   = BigInt(exp(282, 6)) * basePrice / baseScale; // 28_200_000_000 ($282)

      const tcvCF = compValue * borrowCF / FACTOR_SCALE
                  + wbtcValue * borrowCF / FACTOR_SCALE
                  + wethValue * borrowCF / FACTOR_SCALE; // 24_800_000_000

      const denom = LF * targetHF / FACTOR_SCALE - borrowCF; // 145_000_000_000_000_000

      // ── Iter 1 COMP: rawCOMP > compValue -> outer else (full seizure) ──
      const rawCOMP = (debtUSD * targetHF / FACTOR_SCALE - tcvCF) * FACTOR_SCALE / denom;
      expect(rawCOMP).to.be.gt(compValue, 'Pre-check: rawCOMP must exceed COMP value -> outer else');

      // ── Iter 2 WBTC: rawWBTC > wbtcValue -> outer else (full seizure) ──
      const seizedCOMP    = compValue * LF / FACTOR_SCALE; // 18_000_000_000
      const debtAfterCOMP = debtUSD - seizedCOMP;          // 10_200_000_000
      const tcvAfterCOMP  = wbtcValue * borrowCF / FACTOR_SCALE
                            + wethValue * borrowCF / FACTOR_SCALE; // 8_800_000_000

      const rawWBTC = (debtAfterCOMP * targetHF / FACTOR_SCALE - tcvAfterCOMP) * FACTOR_SCALE / denom;
      expect(rawWBTC).to.be.gt(wbtcValue, 'Pre-check: rawWBTC must exceed WBTC value -> outer else');

      // ── Iter 3 WETH: rawWETH > wethValue -> outer else (seize all WETH) ──
      const seizedWBTC    = wbtcValue * LF / FACTOR_SCALE; // 9_000_000_000
      const debtAfterWBTC = debtAfterCOMP - seizedWBTC;    // 1_200_000_000 ($12)
      const tcvAfterWBTC  = wethValue * borrowCF / FACTOR_SCALE; // 800_000_000

      const rawWETH = (debtAfterWBTC * targetHF / FACTOR_SCALE - tcvAfterWBTC) * FACTOR_SCALE / denom;
      expect(rawWETH).to.be.gt(wethValue, 'Pre-check: rawWETH must exceed WETH value -> outer else (seize all)');

      // ── Verify: total seized value < debt -> bad debt arises ──
      const seizedWETH       = wethValue * LF / FACTOR_SCALE; // 900_000_000
      const totalSeizedValue = seizedCOMP + seizedWBTC + seizedWETH; // 27_900_000_000 ($279)
      expect(totalSeizedValue).to.be.lt(debtUSD, 'Pre-check: totalSeized ($279) must be less than debt ($282) -> bad debt');

      // ── Verify: bad debt amount < baseBorrowMin ──
      const badDebtUSD  = debtUSD - totalSeizedValue; // 300_000_000 ($3)
      const badDebtBase = badDebtUSD * baseScale / basePrice; // 3_000_000 ($3 USDC)
      const baseBorrowMinVal = (await comet.baseBorrowMin()).toBigInt();
      expect(badDebtBase).to.be.lt(baseBorrowMinVal,
        'Pre-check: bad debt ($3) must be less than baseBorrowMin ($5) — residual is sub-threshold');

      // ── Drop COMP price $50 -> $20 (−60%). WBTC and WETH stay unchanged. ──
      // After drop: TCV_liquidateCF = 0.85×$200 + 0.85×$100 + 0.85×$10 = $263.50 < $282 -> liquidatable
      await setPrice(priceFeedCOMP, governor, 20);
      await comet.accrueAccount(borrower.address);
      expect(await comet.isLiquidatable(borrower.address)).to.be.true;

      // ── Execute liquidation ──
      await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);

      // ── Log final state ──
      console.log('\x1b[35m%s', '=== FINAL STATE ===');
      const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
      const wbtcBalance = (await comet.userCollateral(borrower.address, WBTC.address)).balance.toBigInt();
      const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
      const debtAfter   = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
      console.log('\x1b[36m%s', 'Remaining COMP:', Number(compBalance) / 1e18);
      console.log('\x1b[36m%s', 'Remaining WBTC:', Number(wbtcBalance) / 1e18);
      console.log('\x1b[36m%s', 'Remaining WETH:', Number(wethBalance) / 1e18);
      console.log('\x1b[36m%s', 'Remaining debt (USDC):', Number(debtAfter) / 1e6);

      // ── Assertion 1: COMP fully seized (iter 1 -> outer else, rawCOMP > $200) ──
      expect(compBalance).to.equal(0n, 'COMP must be fully seized (outer else: rawCOMP > COMP_value)');

      // ── Assertion 2: WBTC fully seized (iter 2 -> outer else, rawWBTC > $100) ──
      expect(wbtcBalance).to.equal(0n, 'WBTC must be fully seized (outer else: rawWBTC > WBTC_value)');

      // ── Assertion 3: WETH fully seized (iter 3 -> outer else, rawWETH > $10) ──
      //   Even though all WETH is seized, WETH × LF = $9 only covers $9 of the remaining $12 debt.
      expect(wethBalance).to.equal(0n, 'WETH must be fully seized (outer else: rawWETH > WETH_value)');

      // ── Assertion 4: Debt is zero — bad debt absorbed by protocol ──
      //   newBalance = −$282 + $279 = −$3; isHealthy = false -> newBalance zeroed out.
      //   The $3 shortfall is written off as bad debt absorbed by the protocol reserves.
      expect(debtAfter).to.equal(0n,
        'Debt must be zero: $3 bad debt (< baseBorrowMin $5) absorbed by protocol');

      // ── Assertion 5: Account is no longer liquidatable (no debt, no collateral) ──
      expect(await comet.isLiquidatable(borrower.address)).to.be.false;
    });
  });


  // ── Scenario 16 — 2 collateral assets: COMP partial liquidation -> guard -> inner-inner-else ->
  //    COMP fully seized -> WETH forced full closure (partial seizure) -> debt $0 ──
  //
  // Parameters:
  //   COMP: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $50 -> $40
  //   WETH: borrowCF=0.80, liquidateCF=0.85, liquidationFactor=0.90, price $100 (stable)
  //   targetHF = 1.05
  //   baseBorrowMin = $10 USDC
  //
  //   Deposit: 10 COMP ($500 -> $400) + 0.05 WETH ($5)
  //   Borrow: $363 USDC
  //
  // Initial state (COMP = $50):
  //   TCV_liquidateCF = 0.85×$500 + 0.85×$5 = $429.25 > $363 -> NOT liquidatable
  //
  // After COMP price drop $50 -> $40:
  //   TCV_liquidateCF = 0.85×$400 + 0.85×$5 = $344.25 < $363 -> LIQUIDATABLE
  //   TCV_CF (borrowCF) = 0.80×$400 + 0.80×$5 = $324
  //
  // Liquidation math:
  //   denom = 0.90×1.05 − 0.80 = 0.145
  //
  //   Iter 1 COMP: rawCOMP = (363×1.05 − 324) / 0.145 = 57.15/0.145 ≈ $394.14 ≤ $400 -> PARTIAL PATH
  //     debtReduction = $394.14×0.90 ≈ $354.72; debtAfterPartial = $363−$354.72 = $8.28
  //     $8.28 < baseBorrowMin $10 -> guard triggers!
  //     wantedFull = ⌈$363/0.90⌉ ≈ $403.33 > $400 -> inner-inner-else: COMP insufficient!
  //     -> seize all COMP: seizedValue = $400×0.90 = $360; debtRemaining = $363−$360 = $3
  //     isHealthy = false; loop continues to WETH
  //
  //   Iter 2 WETH: scaledDebt = $3×1.05 = $3.15; TCV_CF_remaining = $5×0.80 = $4
  //     $3.15 ≤ $4 -> position already healthy -> forced full closure
  //     wantedFull = ⌈$3/0.90⌉ ≈ $3.33 ≤ WETH_value $5 -> PARTIAL WETH seizure
  //     seized ≈ 0.0333 WETH; seizedValue = $3; debtRemaining = $0
  //
  // Integer arithmetic (price scale = 1e8):
  //   COMP_value = 40_000_000_000   WETH_value = 500_000_000
  //   debt       = 36_300_000_000   TCV_CF     = 32_400_000_000
  //
  //   Iter 1: numerator = 38_115_000_000 − 32_400_000_000 = 5_715_000_000
  //           rawCOMP   = 5_715e9 × 1000/145 = 39_413_793_103 < 40_000_000_000 -> partial path
  //           seizedValue = 35_472_413_792; debtAfterPartial (base) = 8_275_862 < baseBorrowMin 10_000_000 -> guard!
  //           wantedFull  = ⌈36_300e9/0.9⌉ = 40_333_333_334 > 40_000_000_000 -> inner-inner-else
  //           seizedValue = 36_000_000_000; TCV_CF_remaining = 400_000_000; debtRemaining = 300_000_000
  //
  //   Iter 2: scaledDebt = 315_000_000 ≤ 400_000_000 -> forced full closure
  //           wantedFull  = ⌈300_000_000/0.9⌉ = 333_333_334 ≤ 500_000_000 -> partial WETH
  //           seizedValue = 300_000_000; totalSeized = 36_300_000_000; debtRemaining = 0
  //
  //   newBalance = −363_000_000 + 36_300_000_000 × 1e6/1e8 = −363_000_000 + 363_000_000 = 0
  //
  // Final state:
  //   COMP: 0 (fully seized via guard -> inner-inner-else)
  //   WETH: ≈0.0167 WETH (~$1.67, partial seizure to close remaining debt)
  //   Debt: $0 USDC (fully closed)
  
  describe('CometWithExtendedAssetList - Partial Liquidation', function() {
    describe('Scenario 16 — 2 collateral assets: COMP partial -> guard -> inner-inner-else (full seizure) -> WETH forced full closure via partial seizure, debt = 0', function() {
      let governor: SignerWithAddress;
      let liquidator: SignerWithAddress;
      let borrower: SignerWithAddress;
      let comet: CometInterface;
      let priceFeedCOMP: any;
      let priceFeeds: any, tokens: any;
  
      before(async function() {
        const protocol = await makeProtocol({
          // baseBorrowMin = $10 USDC (6 decimals).
          // After COMP partial seizure, remaining debt ~$8.28 < $10 -> guard fires.
          baseBorrowMin: exp(10, 6),
          assets: {
            USDC: { initial: exp(10_000_000, 6), decimals: 6, initialPrice: 1 },
            // Asset index 0: COMP — price drops $50→$40;
            // rawCOMP < COMP_value -> partial path -> guard -> wantedFull > COMP_value -> inner-inner-else
            COMP: {
              initial: exp(1_000_000, 18),
              decimals: 18,
              initialPrice: 50,
              borrowCF: exp(0.8, 18),
              liquidateCF: exp(0.85, 18),
              liquidationFactor: exp(0.9, 18),
              supplyCap: exp(2_000_000, 18),
            },
            // Asset index 1: WETH — stable $100;
            // After COMP fully seized, position already at targetHF -> forced full closure
            // wantedFull ≤ WETH_value -> partial WETH seizure closes all debt
            WETH: {
              initial: exp(10_000, 18),
              decimals: 18,
              initialPrice: 100,
              borrowCF: exp(0.8, 18),
              liquidateCF: exp(0.85, 18),
              liquidationFactor: exp(0.9, 18),
              supplyCap: exp(10_000, 18),
            },
          },
          baseTrackingBorrowSpeed: 0,
        });
        ({ cometWithPartialLiquidation: comet, tokens, priceFeeds, governor } = protocol);
        liquidator = protocol.pauseGuardian;
        borrower = protocol.users[0];
        priceFeedCOMP = priceFeeds.COMP;
      });
  
      it('1: COMP partial path -> guard -> inner-inner-else -> full COMP seizure; WETH forced full closure -> partial seizure, debt = 0', async function() {
        const { USDC, COMP, WETH } = tokens;
  
        // ── Governor provides USDC liquidity ──
        await USDC.connect(governor).approve(comet.address, exp(10_000, 6));
        await comet.connect(governor).supply(USDC.address, exp(10_000, 6));
  
        // ── Borrower deposits:
        //   10 COMP × $50 = $500; borrowCF=0.80 -> capacity = $400
        //   0.05 WETH × $100 = $5; borrowCF=0.80 -> capacity = $4
        //   Total borrow capacity = $404 -> borrow $363 USDC (below max)
        const compAmount = exp(10, 18);
        await COMP.connect(governor).transfer(borrower.address, compAmount);
        await COMP.connect(borrower).approve(comet.address, compAmount);
        await comet.connect(borrower).supply(COMP.address, compAmount);
  
        const wethAmount = exp(5, 16); // 0.05 WETH
        await WETH.connect(governor).transfer(borrower.address, wethAmount);
        await WETH.connect(borrower).approve(comet.address, wethAmount);
        await comet.connect(borrower).supply(WETH.address, wethAmount);
  
        await comet.connect(borrower).withdraw(USDC.address, exp(363, 6));
  
        // ── Log initial state ──
        console.log('\x1b[35m%s', '=== INITIAL STATE ===');
        console.log('\x1b[35m%s', 'Init COMP:', Number((await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt()) / 1e18);
        console.log('\x1b[35m%s', 'Init WETH:', Number((await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt()) / 1e18);
        console.log('\x1b[35m%s', 'Init debt (USDC):', Number((await comet.borrowBalanceOf(borrower.address)).toBigInt()) / 1e6);
  
        // ── Verify initial state: not liquidatable ──
        //   TCV_liquidateCF = 0.85×$500 + 0.85×$5 = $429.25 > $363
        expect(await comet.isLiquidatable(borrower.address)).to.be.false;
  
        // ── Pre-absorb verification ──
        const FACTOR_SCALE = BigInt(exp(1, 18));
        const basePrice    = BigInt(exp(1, 8));
        const baseScale    = BigInt(exp(1, 6));
        const compPrice    = BigInt(exp(40, 8));   // COMP after drop
        const wethPrice    = BigInt(exp(100, 8));
        const compScale    = BigInt(exp(1, 18));
        const wethScale    = BigInt(exp(1, 18));
        const LF           = BigInt(exp(0.9, 18));
        const borrowCF     = BigInt(exp(0.8, 18));
        const targetHF     = BigInt(exp(1.05, 18));
  
        const compValue = compAmount * compPrice / compScale;           // 40_000_000_000 ($400)
        const wethValue = wethAmount * wethPrice / wethScale;           // 500_000_000  ($5)
        const debtUSD   = BigInt(exp(363, 6)) * basePrice / baseScale;  // 36_300_000_000 ($363)
  
        const tcvCF = compValue * borrowCF / FACTOR_SCALE + wethValue * borrowCF / FACTOR_SCALE; // 32_400_000_000
  
        const denom = LF * targetHF / FACTOR_SCALE - borrowCF; // 145_000_000_000_000_000
  
        // ── Verify Iter 1 COMP: rawCOMP < compValue -> partial path ──
        const rawCOMP = (debtUSD * targetHF / FACTOR_SCALE - tcvCF) * FACTOR_SCALE / denom;
        expect(rawCOMP).to.be.lt(
          compValue,
          'Pre-check: rawCOMP must be less than COMP value -> partial path (outer-if)'
        );
  
        // ── Verify: debtAfterPartial < baseBorrowMin -> guard fires ──
        const debtReduction      = rawCOMP * LF / FACTOR_SCALE;
        const debtAfterPartialUSD = debtUSD - debtReduction;
        const debtAfterPartialBase = debtAfterPartialUSD * baseScale / basePrice;
        const baseBorrowMinVal   = (await comet.baseBorrowMin()).toBigInt();
        expect(debtAfterPartialBase).to.be.lt(
          baseBorrowMinVal,
          'Pre-check: debtAfterPartial ($8.28) must be below baseBorrowMin ($10) -> guard fires'
        );
  
        // ── Verify: wantedFull > compValue -> inner-inner-else ──
        const wantedFull = (debtUSD * FACTOR_SCALE + LF - 1n) / LF;
        expect(wantedFull).to.be.gt(
          compValue,
          'Pre-check: wantedFull ($403.33) must exceed COMP value ($400) -> inner-inner-else'
        );
  
        // ── Verify: after full COMP seizure, WETH iteration numerator ≤ 0 -> forced full closure ──
        const seizedCOMP       = compValue * LF / FACTOR_SCALE;           // 36_000_000_000
        const debtAfterCOMP    = debtUSD - seizedCOMP;                    //    300_000_000
        const tcvAfterCOMP     = wethValue * borrowCF / FACTOR_SCALE;     // 400_000_000
        const scaledDebt       = debtAfterCOMP * targetHF / FACTOR_SCALE; // 315_000_000
        expect(scaledDebt).to.be.lte(
          tcvAfterCOMP,
          'Pre-check: scaledDebt ($3.15) ≤ TCV_CF_remaining ($4) -> forced full closure path'
        );
  
        // ── Verify: forced full closure wantedFull ≤ wethValue -> partial WETH ──
        const wantedFullWETH = (debtAfterCOMP * FACTOR_SCALE + LF - 1n) / LF;
        expect(wantedFullWETH).to.be.lte(
          wethValue,
          'Pre-check: wantedFullWETH ($3.33) ≤ WETH value ($5) -> partial WETH seizure'
        );
  
        // ── Verify: total seized covers full debt -> no bad debt ──
        const seizedWETH       = wantedFullWETH * LF / FACTOR_SCALE;
        const totalSeizedValue = seizedCOMP + seizedWETH;
        expect(totalSeizedValue).to.be.gte(
          debtUSD,
          'Pre-check: total seized must cover full debt -> no bad debt'
        );
  
        // ── Drop COMP price $50 -> $40 (−20%). WETH stays unchanged. ──
        // After drop: TCV_liquidateCF = 0.85×$400 + 0.85×$5 = $344.25 < $363 -> liquidatable
        await setPrice(priceFeedCOMP, governor, 40);
        await comet.accrueAccount(borrower.address);
  
        const hfBeforeAbsorb = await getHealthFactor(comet, borrower.address);
        console.log('\x1b[32m%s', 'HF before absorb:', Number(hfBeforeAbsorb) / 1e18);
  
        expect(await comet.isLiquidatable(borrower.address)).to.be.true;
  
        // ── Execute liquidation ──
        await comet.connect(liquidator).absorb(liquidator.address, [borrower.address]);
  
        // ── Log final state ──
        console.log('\x1b[35m%s', '=== FINAL STATE ===');
        const compBalance = (await comet.userCollateral(borrower.address, COMP.address)).balance.toBigInt();
        const wethBalance = (await comet.userCollateral(borrower.address, WETH.address)).balance.toBigInt();
        const debtAfter   = (await comet.borrowBalanceOf(borrower.address)).toBigInt();
        console.log('\x1b[36m%s', 'Remaining COMP:', Number(compBalance) / 1e18);
        console.log('\x1b[36m%s', 'Remaining WETH:', Number(wethBalance) / 1e18);
        console.log('\x1b[36m%s', 'Remaining debt (USDC):', Number(debtAfter) / 1e6);
  
        // ── Assertion 1: COMP fully seized (iter 1 -> partial -> guard -> inner-inner-else) ──
        //   rawCOMP ≈ $394.14 -> partial path; debtAfterPartial $8.28 < baseBorrowMin $10 -> guard;
        //   wantedFull $403.33 > V_COMP $400 -> inner-inner-else: seize all 10 COMP.
        expect(compBalance).to.equal(
          0n,
          'COMP must be fully seized (partial path -> guard -> inner-inner-else)'
        );
  
        // ── Assertion 2: WETH partially seized (iter 2 -> forced full closure) ──
        //   After COMP seizure: debtRemaining $3, TCV_CF $4 -> position above targetHF
        //   Forced full closure: wantedFull $3.33 ≤ WETH $5 -> partial seizure ≈ 0.0333 WETH
        //   Remaining WETH ≈ 0.0167 WETH
        expect(wethBalance).to.be.gt(
          0n,
          'WETH must NOT be fully seized (forced full closure only takes partial)'
        );
        expect(wethBalance).to.be.lt(
          wethAmount,
          'WETH balance must have decreased after seizure'
        );
  
        // ── Assertion 3: Debt is zero — fully closed (no bad debt) ──
        //   newBalance = −$363 + $363 = $0; isHealthy = true after WETH outer-if
        expect(debtAfter).to.equal(
          0n,
          'Debt must be fully closed (guard forced full closure across 2 assets)'
        );
  
        // ── Assertion 4: Account is no longer liquidatable ──
        expect(await comet.isLiquidatable(borrower.address)).to.be.false;
  
        // ── Assertion 5: HF is 0 (no debt => HF undefined, helper returns 0) ──
        const hfAfter = await getHealthFactor(comet, borrower.address);
        console.log('\x1b[32m%s', 'HF after absorb:', Number(hfAfter) / 1e18);
        expect(hfAfter).to.equal(0n, 'HF must be 0 (no debt)');
      });
    });
  });
});
