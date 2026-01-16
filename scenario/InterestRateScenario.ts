import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { annualize, defactor, exp, factorScale } from '../test/helpers';
import { BigNumber } from 'ethers';
import { FuzzType } from './constraints/Fuzzing';
import { expectRevertCustom, supportUtilizationLimit } from './utils';

function calculateInterestRate(
  utilization: BigNumber,
  kink: BigNumber,
  interestRateBase: BigNumber,
  interestRateSlopeLow: BigNumber,
  interestRateSlopeHigh: BigNumber,
  isBorrowRate: boolean,
  totalBorrowBase?: BigNumber
): BigNumber {
  const factorScale = BigNumber.from(exp(1, 18));
  if (isBorrowRate && totalBorrowBase !== undefined) {
    if(totalBorrowBase.isZero()) return BigNumber.from(0);
  }
  
  if (utilization.lte(kink)) {
    const interestRateWithoutBase = interestRateSlopeLow.mul(utilization).div(factorScale);
    return interestRateBase.add(interestRateWithoutBase);
  } else {
    const rateSlopeLow = interestRateSlopeLow.mul(kink).div(factorScale);
    const rateSlopeHigh = interestRateSlopeHigh.mul(utilization.sub(kink)).div(factorScale);
    return interestRateBase.add(rateSlopeLow).add(rateSlopeHigh);
  }
}

function calculateUtilization(
  totalSupplyBase: BigNumber,
  totalBorrowBase: BigNumber,
  baseSupplyIndex: BigNumber,
  baseBorrowIndex: BigNumber,
  factorScale = BigNumber.from(exp(1, 18))
): BigNumber {
  if (totalSupplyBase.isZero()) {
    return BigNumber.from(0);
  } else {
    const totalSupply = totalSupplyBase.mul(baseSupplyIndex).div(factorScale);
    const totalBorrow = totalBorrowBase.mul(baseBorrowIndex).div(factorScale);
    return totalBorrow.mul(factorScale).div(totalSupply);
  }
}

scenario(
  'Comet#interestRate > rates using on-chain configuration constants',
  {},
  async ({ comet }) => {
    let { totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex } = await comet.totalsBasic();
    const supplyKink = await comet.supplyKink();
    const supplyPerSecondInterestRateBase = await comet.supplyPerSecondInterestRateBase();
    const supplyPerSecondInterestRateSlopeLow = await comet.supplyPerSecondInterestRateSlopeLow();
    const supplyPerSecondInterestRateSlopeHigh = await comet.supplyPerSecondInterestRateSlopeHigh();
    const borrowKink = await comet.borrowKink();
    const borrowPerSecondInterestRateBase = await comet.borrowPerSecondInterestRateBase();
    const borrowPerSecondInterestRateSlopeLow = await comet.borrowPerSecondInterestRateSlopeLow();
    const borrowPerSecondInterestRateSlopeHigh = await comet.borrowPerSecondInterestRateSlopeHigh();

    const actualUtilization = await comet.getUtilization();
    const expectedUtilization = calculateUtilization(totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex);

    expect(defactor(actualUtilization)).to.be.approximately(defactor(expectedUtilization), 0.00001);
    expect(await comet.getSupplyRate(actualUtilization)).to.equal(
      calculateInterestRate(
        actualUtilization,
        supplyKink,
        supplyPerSecondInterestRateBase,
        supplyPerSecondInterestRateSlopeLow,
        supplyPerSecondInterestRateSlopeHigh,
        false
      )
    );
    totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
    expect(await comet.getBorrowRate(actualUtilization)).to.equal(
      calculateInterestRate(
        actualUtilization,
        borrowKink,
        borrowPerSecondInterestRateBase,
        borrowPerSecondInterestRateSlopeLow,
        borrowPerSecondInterestRateSlopeHigh,
        true,
        totalBorrowBase
      )
    );
  }
);

scenario(
  'Comet#interestRate > below kink rates using hypothetical configuration constants',
  {
    upgrade: {
      supplyKink: exp(0.8, 18),
      supplyPerYearInterestRateBase: exp(0, 18),
      supplyPerYearInterestRateSlopeLow: exp(0.04, 18),
      supplyPerYearInterestRateSlopeHigh: exp(0.4, 18),
      borrowKink: exp(0.8, 18),
      borrowPerYearInterestRateBase: exp(0.01, 18),
      borrowPerYearInterestRateSlopeLow: exp(0.05, 18),
      borrowPerYearInterestRateSlopeHigh: exp(0.3, 18),
    },
    utilization: 0.5,
  },
  async ({ comet }) => {
    const utilization = await comet.getUtilization();
    expect(defactor(utilization)).to.be.approximately(0.5, 0.00001);
    expect(annualize(await comet.getSupplyRate(utilization))).to.be.approximately(0.02, 0.001);
    expect(annualize(await comet.getBorrowRate(utilization))).to.be.approximately(0.035, 0.001);
  }
);

scenario(
  'Comet#interestRate > above kink rates using hypothetical configuration constants',
  {
    upgrade: {
      supplyKink: exp(0.8, 18),
      supplyPerYearInterestRateBase: exp(0, 18),
      supplyPerYearInterestRateSlopeLow: exp(0.04, 18),
      supplyPerYearInterestRateSlopeHigh: exp(0.4, 18),
      borrowKink: exp(0.8, 18),
      borrowPerYearInterestRateBase: exp(0.01, 18),
      borrowPerYearInterestRateSlopeLow: exp(0.05, 18),
      borrowPerYearInterestRateSlopeHigh: exp(0.3, 18),
    },
    utilization: 0.85,
  },
  async ({ comet }) => {
    const utilization = await comet.getUtilization();
    expect(defactor(utilization)).to.be.approximately(0.85, 0.00001);
    expect(annualize(await comet.getSupplyRate(utilization))).to.be.approximately(0.052, 0.001);
    expect(annualize(await comet.getBorrowRate(utilization))).to.be.approximately(0.065, 0.001);
  }
);

scenario(
  'Comet#interestRate > rates using fuzzed configuration constants',
  {
    upgrade: {
      // TODO: Read types directly from Solidity?
      supplyPerYearInterestRateBase: { type: FuzzType.UINT64 },
      borrowPerYearInterestRateBase: { type: FuzzType.UINT64, max: (1e18).toString() /* 100% */ },
    }
  },
  async ({ comet }) => {
    let { totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex } = await comet.totalsBasic();
    const supplyKink = await comet.supplyKink();
    const supplyPerSecondInterestRateBase = await comet.supplyPerSecondInterestRateBase();
    const supplyPerSecondInterestRateSlopeLow = await comet.supplyPerSecondInterestRateSlopeLow();
    const supplyPerSecondInterestRateSlopeHigh = await comet.supplyPerSecondInterestRateSlopeHigh();
    const borrowKink = await comet.borrowKink();
    const borrowPerSecondInterestRateBase = await comet.borrowPerSecondInterestRateBase();
    const borrowPerSecondInterestRateSlopeLow = await comet.borrowPerSecondInterestRateSlopeLow();
    const borrowPerSecondInterestRateSlopeHigh = await comet.borrowPerSecondInterestRateSlopeHigh();


    const actualUtilization = await comet.getUtilization();
    const expectedUtilization = calculateUtilization(totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex);

    expect(defactor(actualUtilization)).to.be.approximately(defactor(expectedUtilization), 0.00001);
    expect(await comet.getSupplyRate(actualUtilization)).to.equal(
      calculateInterestRate(
        actualUtilization,
        supplyKink,
        supplyPerSecondInterestRateBase,
        supplyPerSecondInterestRateSlopeLow,
        supplyPerSecondInterestRateSlopeHigh,
        false
      )
    );
    totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
    expect(await comet.getBorrowRate(actualUtilization)).to.equal(
      calculateInterestRate(
        actualUtilization,
        borrowKink,
        borrowPerSecondInterestRateBase,
        borrowPerSecondInterestRateSlopeLow,
        borrowPerSecondInterestRateSlopeHigh,
        true,
        totalBorrowBase
      )
    );
  }
);

// TODO: Scenario for testing custom configuration constants using a utilization constraint.
// XXX this test seems too fickle
scenario.skip(
  'Comet#interestRate > when utilization is 50%',
  { utilization: 0.5 },
  async ({ comet }, context) => {
    const utilization = await comet.getUtilization();
    expect(defactor(utilization)).to.be.approximately(0.5, 0.00001);

    // Note: this is dependent on the `deployments/fuji/configuration.json` variables
    // TODO: Consider if there's a better way to test the live curve.
    if (context.world.base.network === 'fuji') {
      // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
      // utilization = 50%
      // ( 1% + 2% * 50% ) * 50% * (100% - 10%)
      // ( 1% + 1% ) * 50% * 90% -> 1% * 90% = 0.9%
      expect(annualize(await comet.getSupplyRate(utilization))).to.be.approximately(0.009, 0.001);

      // interestRateBase + interestRateSlopeLow * utilization
      // utilization = 50%
      // ( 1% + 2% * 50% )
      expect(annualize(await comet.getBorrowRate(utilization))).to.be.approximately(0.02, 0.001);
    }
  }
);

scenario(
  'Comet#interestRate reverts for pushing utilization above 200%',
  {
    filter: async (ctx: CometContext) => await supportUtilizationLimit(ctx),
  },
  async ({ comet }, context: CometContext) => {
    const { albert, betty } = context.actors;
    const { asset, scale, borrowCollateralFactor, priceFeed } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const baseTokenAddress = await comet.baseToken();
    const baseToken = context.getAssetByAddress(baseTokenAddress);
    
    // Get constants
    const baseScale = (await comet.baseScale()).toBigInt();
    const collateralScale = scale.toBigInt();
    const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
    const collateralPrice = (await comet.getPrice(priceFeed)).toBigInt();
    
    // Step 1: Set up a known supply state
    // Supply a fixed amount of base tokens to establish a baseline
    const baseSupplyAmount = 10n * baseScale; // 10 base tokens
    await context.sourceTokens(baseSupplyAmount, baseToken.address, betty.address);
    await baseToken.approve(betty, comet.address);
    await betty.supplyAsset({ asset: baseToken.address, amount: baseSupplyAmount });
    
    // Get current state after supply
    let currentTotalSupply = (await comet.totalSupply()).toBigInt();
    
    // Step 2: Calculate borrow amount to exceed 200% utilization
    // We want to borrow enough so that: (currentTotalBorrow + borrowAmount) / currentTotalSupply > 2
    // Simplest approach: borrow 3x the current supply (which gives 300% utilization if no existing borrow)
    // This ensures we definitely exceed 200% even with existing borrows
    let targetBorrowAmount = 3n * currentTotalSupply;
    
    // Ensure we have enough base tokens available to borrow
    // We need: supply + reserves >= borrowAmount
    // If not, we need to supply more. If we supply more, utilization goes down,
    // so we need to borrow even more. Let's supply enough to cover the borrow.
    const currentReserves = (await comet.getReserves()).toBigInt();
    const availableToBorrow = currentTotalSupply + (currentReserves > 0n ? currentReserves : 0n);
    
    if (targetBorrowAmount > availableToBorrow) {
      // Supply enough to cover the borrow
      // We need: newSupply >= targetBorrowAmount
      // So: additionalSupply = targetBorrowAmount - currentTotalSupply (assuming no reserves)
      const additionalSupply = targetBorrowAmount - currentTotalSupply + baseScale;
      await context.sourceTokens(additionalSupply, baseToken.address, betty.address);
      await baseToken.approve(betty, comet.address);
      await betty.supplyAsset({ asset: baseToken.address, amount: additionalSupply });
      
      // Recalculate: now we have more supply, so we need to borrow even more to exceed 200%
      currentTotalSupply = (await comet.totalSupply()).toBigInt();
      targetBorrowAmount = 3n * currentTotalSupply;
    }
    
    // Step 4: Calculate collateral needed for the borrow
    // We need enough collateral to support the borrow based on borrowCollateralFactor
    const collateralWeiPerUnitBase = (collateralScale * basePrice) / collateralPrice;
    let collateralNeeded = (collateralWeiPerUnitBase * targetBorrowAmount) / baseScale;
    collateralNeeded = (collateralNeeded * factorScale) / borrowCollateralFactor.toBigInt(); // adjust for borrowCollateralFactor
    collateralNeeded = (collateralNeeded * 11n) / 10n; // add 10% fudge factor for safety
    
    // Step 5: Source collateral tokens for albert and have him supply
    await context.sourceTokens(collateralNeeded, collateralAsset.address, albert.address);
    await collateralAsset.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: collateralAsset.address, amount: collateralNeeded });

    // Step 6: Try to borrow base asset, which should revert with ExceedsSupportedUtilization
    // The borrow should push utilization above 200%
    await expectRevertCustom(
      albert.withdrawAsset({ asset: baseTokenAddress, amount: targetBorrowAmount }),
      'ExceedsSupportedUtilization()'
    );
  }
);
