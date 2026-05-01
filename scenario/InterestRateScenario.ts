import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { annualize, defactor, exp, factorScale } from '../test/helpers';
import { BigNumber } from 'ethers';
import { FuzzType } from './constraints/Fuzzing';
import { expectRevertCustom, supportUtilizationLimit, isFreshMarket } from './utils';
import { getConfigForScenario } from './utils/scenarioHelper';

function calculateInterestRateSupply(
  utilization: BigNumber,
  kink: BigNumber,
  interestRateBase: BigNumber,
  interestRateSlopeLow: BigNumber,
  interestRateSlopeHigh: BigNumber,
  totalSupplyBase: BigNumber
): BigNumber {
  const factorScale = BigNumber.from(exp(1, 18));

  if (totalSupplyBase.isZero()) return BigNumber.from(0);
  
  if (utilization.lte(kink)) {
    const interestRateWithoutBase = interestRateSlopeLow.mul(utilization).div(factorScale);
    return interestRateBase.add(interestRateWithoutBase);
  } else {
    const rateSlopeLow = interestRateSlopeLow.mul(kink).div(factorScale);
    const rateSlopeHigh = interestRateSlopeHigh.mul(utilization.sub(kink)).div(factorScale);
    return interestRateBase.add(rateSlopeLow).add(rateSlopeHigh);
  }
}

function calculateInterestRateBorrow(
  utilization: BigNumber,
  kink: BigNumber,
  interestRateBase: BigNumber,
  interestRateSlopeLow: BigNumber,
  interestRateSlopeHigh: BigNumber,
  totalBorrowBase?: BigNumber,
): BigNumber {
  const factorScale = BigNumber.from(exp(1, 18));
  
  if(totalBorrowBase.isZero()) return BigNumber.from(0);
  
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
    totalSupplyBase = (await comet.totalsBasic()).totalSupplyBase;
    expect(await comet.getSupplyRate(actualUtilization)).to.equal(
      calculateInterestRateSupply(
        actualUtilization,
        supplyKink,
        supplyPerSecondInterestRateBase,
        supplyPerSecondInterestRateSlopeLow,
        supplyPerSecondInterestRateSlopeHigh,
        totalSupplyBase
      )
    );
    totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
    expect(await comet.getBorrowRate(actualUtilization)).to.equal(
      calculateInterestRateBorrow(
        actualUtilization,
        borrowKink,
        borrowPerSecondInterestRateBase,
        borrowPerSecondInterestRateSlopeLow,
        borrowPerSecondInterestRateSlopeHigh,
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
    totalSupplyBase = (await comet.totalsBasic()).totalSupplyBase;
    expect(await comet.getSupplyRate(actualUtilization)).to.equal(
      calculateInterestRateSupply(
        actualUtilization,
        supplyKink,
        supplyPerSecondInterestRateBase,
        supplyPerSecondInterestRateSlopeLow,
        supplyPerSecondInterestRateSlopeHigh,
        totalSupplyBase
      )
    );
    totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
    expect(await comet.getBorrowRate(actualUtilization)).to.equal(
      calculateInterestRateBorrow(
        actualUtilization,
        borrowKink,
        borrowPerSecondInterestRateBase,
        borrowPerSecondInterestRateSlopeLow,
        borrowPerSecondInterestRateSlopeHigh,
        totalBorrowBase,
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
    filter: async (ctx: CometContext) => await supportUtilizationLimit(ctx) && await isFreshMarket(ctx),
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

/**
 * @notice Verifies that supply index remains unchanged when market has no supplies
 * @dev `if (totalSupplyBase == 0) return 0;`
 *      When there are no lenders in the market, supply rate should be 0 and
 *      baseSupplyIndex should not accrue even after time passes.
 *      This prevents phantom interest accrual on an empty market.
 */
scenario(
  'Comet#interestRate > supply index does not change when there are no supplies',
  {
    filter: async (ctx: CometContext) => await supportUtilizationLimit(ctx) && await isFreshMarket(ctx),
    upgrade: {
      supplyKink: exp(0.8, 18),
      supplyPerYearInterestRateBase: exp(0.001, 18),
      supplyPerYearInterestRateSlopeLow: exp(0.04, 18),
      supplyPerYearInterestRateSlopeHigh: exp(0.4, 18),
      borrowKink: exp(0.8, 18),
      borrowPerYearInterestRateBase: exp(0.01, 18),
      borrowPerYearInterestRateSlopeLow: exp(0.05, 18),
      borrowPerYearInterestRateSlopeHigh: exp(0.3, 18),
    },
  },
  async ({ comet }, context: CometContext) => {
    const ethers = context.world.deploymentManager.hre.ethers;

    // Get initial state
    const initialTotals = await comet.totalsBasic();
    const initialSupplyIndex = initialTotals.baseSupplyIndex;

    // Verify there are no supplies (totalSupplyBase == 0)
    expect(initialTotals.totalSupplyBase.toBigInt()).to.equal(0n);

    // Verify supply rate is 0 when there are no supplies
    const supplyRate = await comet.getSupplyRate(0);
    expect(supplyRate.toBigInt()).to.equal(0n);

    // Skip some time (1 hour)
    await ethers.provider.send('evm_increaseTime', [3600]);
    await ethers.provider.send('evm_mine', []);

    // Trigger accrue by calling accrueAccount
    await comet.accrueAccount(ethers.constants.AddressZero);

    // Get state after time skip
    const finalTotals = await comet.totalsBasic();
    const finalSupplyIndex = finalTotals.baseSupplyIndex;

    // Verify baseSupplyIndex has not changed
    expect(finalSupplyIndex.toBigInt()).to.equal(initialSupplyIndex.toBigInt());

    // Verify lastAccrualTime was updated (accrual happened but index didn't change)
    expect(finalTotals.lastAccrualTime).to.be.greaterThan(initialTotals.lastAccrualTime);
  }
);

/**
 * @notice Verifies that supply index does not grow when there are supplies but no reserves
 * @dev When lenders supply to the market but there are no reserves (or reserves are exhausted),
 *      the baseSupplyIndex should not increase because there are no funds to pay interest from.
 *      This prevents lenders from accruing interest that cannot be withdrawn (illiquidity protection).
 */
scenario(
  'Comet#interestRate > supply index does not grow without reserves even with supplies',
  {
    filter: async (ctx: CometContext) => await supportUtilizationLimit(ctx) && await isFreshMarket(ctx),
    upgrade: {
      supplyKink: exp(0.8, 18),
      supplyPerYearInterestRateBase: exp(0.001, 18),
      supplyPerYearInterestRateSlopeLow: exp(0.04, 18),
      supplyPerYearInterestRateSlopeHigh: exp(0.4, 18),
      borrowKink: exp(0.8, 18),
      borrowPerYearInterestRateBase: exp(0.01, 18),
      borrowPerYearInterestRateSlopeLow: exp(0.05, 18),
      borrowPerYearInterestRateSlopeHigh: exp(0.3, 18),
    },
  },
  async ({ comet }, context: CometContext) => {
    const ethers = context.world.deploymentManager.hre.ethers;
    const { albert } = context.actors;

    const baseTokenAddress = await comet.baseToken();
    const baseToken = context.getAssetByAddress(baseTokenAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    const totalsBeforeSupply = await comet.totalsBasic();

    // Supply some base tokens to the market
    const supplyAmount = BigInt(getConfigForScenario(context).supplyBase) * baseScale;
    await context.sourceTokens(supplyAmount, baseToken.address, albert.address);
    await baseToken.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: baseToken.address, amount: supplyAmount });

    // Verify supply was successful
    const totalsAfterSupply = await comet.totalsBasic();
    expect(totalsAfterSupply.totalSupplyBase.toBigInt()).to.equal(totalsBeforeSupply.totalSupplyBase.toBigInt() + supplyAmount);
    
    // Get supply index before time skip
    const prevSupplyIndex = totalsAfterSupply.baseSupplyIndex;

    // Skip some time (1 hour)
    await ethers.provider.send('evm_increaseTime', [3600]);
    await ethers.provider.send('evm_mine', []);

    // Trigger accrue
    await comet.accrueAccount(ethers.constants.AddressZero);

    // Get state after time skip
    const finalTotals = await comet.totalsBasic();
    const finalSupplyIndex = finalTotals.baseSupplyIndex;

    // Verify baseSupplyIndex has not changed because there are no reserves to fund the interest
    expect(finalSupplyIndex.toBigInt()).to.equal(prevSupplyIndex.toBigInt());

    // Verify utilization is 0 (no borrows)
    expect((await comet.getUtilization()).toBigInt()).to.equal(0n);
  }
);

/**
 * @notice Verifies that supply index grows when there are both supplies and reserves
 * @dev When lenders supply to the market AND there are reserves available,
 *      the baseSupplyIndex should increase according to the base supply rate.
 *      Reserves fund the interest payments to lenders when there are no borrowers.
 */
scenario(
  'Comet#interestRate > supply index grows with reserves and supplies',
  {
    filter: async (ctx: CometContext) => await supportUtilizationLimit(ctx) && await isFreshMarket(ctx),
    upgrade: {
      supplyKink: exp(0.8, 18),
      supplyPerYearInterestRateBase: exp(0.001, 18),
      supplyPerYearInterestRateSlopeLow: exp(0.04, 18),
      supplyPerYearInterestRateSlopeHigh: exp(0.4, 18),
      borrowKink: exp(0.8, 18),
      borrowPerYearInterestRateBase: exp(0.01, 18),
      borrowPerYearInterestRateSlopeLow: exp(0.05, 18),
      borrowPerYearInterestRateSlopeHigh: exp(0.3, 18),
    },
  },
  async ({ comet }, context: CometContext) => {
    const ethers = context.world.deploymentManager.hre.ethers;
    const { albert } = context.actors;

    const baseTokenAddress = await comet.baseToken();
    const baseToken = context.getAssetByAddress(baseTokenAddress);
    const baseScale = (await comet.baseScale()).toBigInt();

    // Supply some base tokens to the market
    const supplyAmount = BigInt(getConfigForScenario(context).supplyBase) * baseScale;
    await context.sourceTokens(supplyAmount, baseToken.address, albert.address);
    await baseToken.approve(albert, comet.address);
    await albert.supplyAsset({ asset: baseToken.address, amount: supplyAmount });

    // Add reserves to the market (send tokens directly to comet without supplying)
    const reservesAmount = BigInt(getConfigForScenario(context).reservesBase) * baseScale;
    await context.sourceTokens(reservesAmount, baseToken.address, comet.address);

    // Verify reserves are positive
    const reserves = await comet.getReserves();
    expect(reserves.toBigInt()).to.be.greaterThan(0n);

    // Get state before time skip
    const totalsBeforeAccrue = await comet.totalsBasic();
    const prevSupplyIndex = totalsBeforeAccrue.baseSupplyIndex;
    const prevLastAccrualTime = totalsBeforeAccrue.lastAccrualTime;

    // Verify supply rate is positive (base rate applies since utilization is 0 but reserves exist)
    const supplyRate = await comet.getSupplyRate(0);
    expect(supplyRate.toBigInt()).to.be.greaterThan(0n);

    // Skip some time (1 hour)
    await ethers.provider.send('evm_increaseTime', [3600]);
    await ethers.provider.send('evm_mine', []);

    // Trigger accrue
    await comet.accrueAccount(ethers.constants.AddressZero);

    // Get state after time skip
    const finalTotals = await comet.totalsBasic();
    const finalSupplyIndex = finalTotals.baseSupplyIndex;
    const timeElapsed = finalTotals.lastAccrualTime - prevLastAccrualTime;

    // Calculate expected supply index growth
    // accruedIndex = prevIndex + prevIndex * supplyRate * timeElapsed / 1e18
    const expectedAccruedIndex = prevSupplyIndex.add(
      prevSupplyIndex.mul(supplyRate).mul(timeElapsed).div(exp(1, 18))
    );

    // Verify baseSupplyIndex has grown
    expect(finalSupplyIndex).to.be.greaterThan(prevSupplyIndex);
    expect(finalSupplyIndex).to.equal(expectedAccruedIndex);

    // Verify utilization is still 0 (no borrows)
    expect((await comet.getUtilization()).toBigInt()).to.equal(0n);
  }
);

/**
 * @notice Verifies that supply interest accrual is capped by available reserves when there are no borrows
 * @dev In a new market with lenders but no borrowers, lenders earn the base supply rate funded from reserves.
 *      Without this safeguard, totalSupply() could exceed the actual token balance, causing illiquidity.
 *      Once reserves are exhausted (totalSupply >= balance), the supply index stops growing
 *      to ensure lenders can always withdraw their entitled amounts.
 */
scenario(
  'Comet#interestRate > supply interest does not exceed reserves without borrows',
  {
    filter: async (ctx: CometContext) => await supportUtilizationLimit(ctx) && await isFreshMarket(ctx),
    upgrade: {
      supplyKink: exp(0.8, 18),
      supplyPerYearInterestRateBase: exp(0.001, 18),
      supplyPerYearInterestRateSlopeLow: exp(0.04, 18),
      supplyPerYearInterestRateSlopeHigh: exp(0.4, 18),
      borrowKink: exp(0.8, 18),
      borrowPerYearInterestRateBase: exp(0.01, 18),
      borrowPerYearInterestRateSlopeLow: exp(0.05, 18),
      borrowPerYearInterestRateSlopeHigh: exp(0.3, 18),
    },
  },
  async ({ comet }, context: CometContext) => {
    const ethers = context.world.deploymentManager.hre.ethers;
    const { albert, betty } = context.actors;

    const baseTokenAddress = await comet.baseToken();
    const baseToken = context.getAssetByAddress(baseTokenAddress);
    const baseScale = (await comet.baseScale()).toBigInt();

    // Supply base tokens to the market
    const supplyAmount = BigInt(getConfigForScenario(context).supplyBase) * baseScale;
    await context.sourceTokens(supplyAmount, baseToken.address, albert.address);
    await baseToken.approve(albert, comet.address);
    await albert.supplyAsset({ asset: baseToken.address, amount: supplyAmount });

    // Another user also supplies
    await context.sourceTokens(supplyAmount, baseToken.address, betty.address);
    await baseToken.approve(betty, comet.address);
    await betty.supplyAsset({ asset: baseToken.address, amount: supplyAmount });

    // Add reserves to the market
    const initialReserves = BigInt(getConfigForScenario(context).reservesBase) * baseScale;
    await context.sourceTokens(initialReserves, baseToken.address, comet.address);

    // Get supply rate (base rate since utilization is 0)
    const supplyPerSecondInterestRateBase = await comet.supplyPerSecondInterestRateBase();

    // Calculate time needed for reserves to be consumed by interest
    // Interest accrued = principal * rate * time
    // When totalSupply() reaches balance, interest stops accruing
    // We need to find time such that: initialSupply * (1 + rate*time) >= balance
    // Simplification: time = reserves / (supply * rate)
    const totalSupplyBase = (await comet.totalsBasic()).totalSupplyBase.toBigInt();
    const expectedTimeToExhaustReserves = (initialReserves * BigInt(exp(1, 18))) / 
      (totalSupplyBase * supplyPerSecondInterestRateBase.toBigInt());

    // Skip time significantly past when reserves should be exhausted
    const timeToSkip = Number(expectedTimeToExhaustReserves) + 3600; // Add 1 hour buffer
    await ethers.provider.send('evm_increaseTime', [timeToSkip]);
    await ethers.provider.send('evm_mine', []);

    // Trigger accrue
    await comet.accrueAccount(ethers.constants.AddressZero);

    // After reserves are exhausted, totalSupply() should approximately equal the base token balance
    const totalSupply = await comet.totalSupply();
    const cometBalance = await baseToken.balanceOf(comet.address);

    // totalSupply should be approximately equal to or less than balance (within rounding)
    expect(totalSupply.toBigInt()).to.be.approximately(cometBalance, 10000000);

    // Get the supply index after reserves exhaustion
    const totalsAfterExhaustion = await comet.totalsBasic();
    const indexAfterExhaustion = totalsAfterExhaustion.baseSupplyIndex;

    const baseBalance = await baseToken.balanceOf(comet.address);
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    expect(indexAfterExhaustion).to.equal(baseBalance * baseIndexScale / totalSupplyBase);

    // Skip more time
    await ethers.provider.send('evm_increaseTime', [3600]); // 1 more hour
    await ethers.provider.send('evm_mine', []);

    // Trigger accrue again
    await comet.accrueAccount(ethers.constants.AddressZero);

    // Get final state
    const finalTotals = await comet.totalsBasic();
    const finalSupplyIndex = finalTotals.baseSupplyIndex;

    // Supply index should NOT have grown further (reserves exhausted)
    expect(finalSupplyIndex.toBigInt()).to.equal(indexAfterExhaustion.toBigInt());

    // Supply rate should now be the base rate
    const supplyRateNow = await comet.getSupplyRate(0);
    expect(supplyRateNow.toBigInt()).to.equal((await comet.supplyPerSecondInterestRateBase()).toBigInt());
  }
);
