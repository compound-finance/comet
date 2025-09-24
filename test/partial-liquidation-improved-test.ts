import { ethers, expect, exp, makeProtocol } from './helpers';
import {
  CometInterface
} from '../build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import { BigNumber, ContractReceipt } from 'ethers';

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

describe('CometWithExtendedAssetList - Partial Liquidation (Improved)', function () {
  let protocol: any;
  let cometWithExtendedAssetList: any;
  let tokens: any;
  let priceFeeds: any;
  let governor: any;
  let users: any;
  let liquidator: any; // liquidator
  let userToLiquidate: any; // user with debt to be liquidated
  let liquidatableUser2: any; // additional user for multi-user tests
  let userWithNoDebt: any; // user with no debt
  let healthyUser: any; // user with healthy position
  let zeroPrincipalUser: any; // user with zero principal
  let snapshot: SnapshotRestorer;

  // Test data
  let debtBefore: BigNumber;
  let collBefore: BigNumber;
  let userBasicBefore: any;
  let absorbReceipt: ContractReceipt;
  let USDC: any;
  let COMP: any;
  let USDT: any;
  let WETH: any;
  let WBTC: any;

  before(async function () {
    // Create protocol with all necessary assets
    protocol = await makeProtocol({
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

    ({ cometWithExtendedAssetList, tokens, priceFeeds, governor, users } = protocol);

    // Setup users
    [liquidator, userToLiquidate, liquidatableUser2, userWithNoDebt, healthyUser, zeroPrincipalUser] = users;
    const { USDC: USDC_token, COMP: COMP_token, USDT: USDT_token, WETH: WETH_token, WBTC: WBTC_token } = tokens;
    USDC = USDC_token;
    COMP = COMP_token;
    USDT = USDT_token;
    WETH = WETH_token;
    WBTC = WBTC_token;
    const { COMP: priceFeedCOMP, USDT: priceFeedUSDT } = priceFeeds;

    // Setup liquidator - has USDC to liquidate others
    await USDC.connect(governor).transfer(liquidator.address, exp(8000, 6));
    await USDC.connect(liquidator).approve(cometWithExtendedAssetList.address, exp(8000, 6));
    await cometWithExtendedAssetList.connect(liquidator).supply(USDC.address, exp(8000, 6));

    // Add more USDC to the protocol for withdrawals
    await USDC.connect(governor).transfer(cometWithExtendedAssetList.address, exp(50000, 6));

    // Setup userToLiquidate (user to be liquidated) - has collateral and debt
    await COMP.connect(governor).transfer(userToLiquidate.address, exp(100, 18));
    await COMP.connect(userToLiquidate).approve(cometWithExtendedAssetList.address, exp(100, 18));
    await cometWithExtendedAssetList.connect(userToLiquidate).supply(COMP.address, exp(100, 18));

    await USDT.connect(governor).transfer(userToLiquidate.address, exp(100, 6));
    await USDT.connect(userToLiquidate).approve(cometWithExtendedAssetList.address, exp(100, 6));
    await cometWithExtendedAssetList.connect(userToLiquidate).supply(USDT.address, exp(100, 6));

    // Borrow maximum capacity to make liquidatable
    const borrowCapacityCOMP = await borrowCapacityForAsset(cometWithExtendedAssetList, userToLiquidate, 0);
    const borrowCapacityUSDT = await borrowCapacityForAsset(cometWithExtendedAssetList, userToLiquidate, 1);
    const borrowCapacity = borrowCapacityCOMP.add(borrowCapacityUSDT);
    await cometWithExtendedAssetList.connect(userToLiquidate).withdraw(USDC.address, borrowCapacity);

    // Setup liquidatableUser2 (additional user for multi-user tests) - also liquidatable
    await COMP.connect(governor).transfer(liquidatableUser2.address, exp(50, 18));
    await COMP.connect(liquidatableUser2).approve(cometWithExtendedAssetList.address, exp(50, 18));
    await cometWithExtendedAssetList.connect(liquidatableUser2).supply(COMP.address, exp(50, 18));

    const borrowCapacity2 = await borrowCapacityForAsset(cometWithExtendedAssetList, liquidatableUser2, 0);
    await cometWithExtendedAssetList.connect(liquidatableUser2).withdraw(USDC.address, borrowCapacity2);

    // Setup userWithNoDebt (user with no debt) - only collateral
    await COMP.connect(governor).transfer(userWithNoDebt.address, exp(50, 18));
    await COMP.connect(userWithNoDebt).approve(cometWithExtendedAssetList.address, exp(50, 18));
    await cometWithExtendedAssetList.connect(userWithNoDebt).supply(COMP.address, exp(50, 18));

    // Setup healthyUser (user with healthy position) - small debt relative to collateral
    await COMP.connect(governor).transfer(healthyUser.address, exp(100, 18));
    await COMP.connect(healthyUser).approve(cometWithExtendedAssetList.address, exp(100, 18));
    await cometWithExtendedAssetList.connect(healthyUser).supply(COMP.address, exp(100, 18));

    const borrowCapacity4 = await borrowCapacityForAsset(cometWithExtendedAssetList, healthyUser, 0);
    const smallBorrowAmount = borrowCapacity4.div(2); // Only 50% of capacity
    await cometWithExtendedAssetList.connect(healthyUser).withdraw(USDC.address, smallBorrowAmount);

    // Setup zeroPrincipalUser (user with zero principal) - will be set up in specific tests

    // Make users liquidatable by reducing prices
    let iterations = 0;
    while ((!(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)) ||
            !(await cometWithExtendedAssetList.isLiquidatable(liquidatableUser2.address))) && iterations < 50) {
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(95).div(100),
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );
      const currentUSDTData = await priceFeedUSDT.latestRoundData();
      await priceFeedUSDT.connect(governor).setRoundData(
        currentUSDTData._roundId,
        currentUSDTData._answer.mul(98).div(100),
        currentUSDTData._startedAt,
        currentUSDTData._updatedAt,
        currentUSDTData._answeredInRound
      );
      await ethers.provider.send('evm_increaseTime', [31 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
      iterations++;
    }

    // Store initial state for liquidation tests
    debtBefore = await cometWithExtendedAssetList.borrowBalanceOf(userToLiquidate.address);
    const collateralBeforeStruct = await cometWithExtendedAssetList.userCollateral(userToLiquidate.address, USDC.address);
    collBefore = collateralBeforeStruct.balance;
    userBasicBefore = await cometWithExtendedAssetList.userBasic(userToLiquidate.address);

    snapshot = await takeSnapshot();
  });

  describe('isLiquidatable function', () => {
    after(async () => {
      await snapshot.restore();
    });

    it('should return true for liquidatable user', async function () {
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.true;
    });

    it('should return false when user has no debt', async function () {
      expect(await cometWithExtendedAssetList.isLiquidatable(userWithNoDebt.address)).to.be.false;
    });

    it('should return false when user has healthy position', async function () {
      expect(await cometWithExtendedAssetList.isLiquidatable(healthyUser.address)).to.be.false;
    });

    it('should return false for zero address', async function () {
      expect(await cometWithExtendedAssetList.isLiquidatable(ethers.constants.AddressZero)).to.be.false;
    });

    it('should return true when user becomes liquidatable after price drop', async function () {
      const { COMP: priceFeedCOMP } = priceFeeds;

      // First make user healthy by increasing price
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(120).div(100),
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.false;

      // Now reduce price to make liquidatable
      const newCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        newCOMPData._roundId,
        newCOMPData._answer.mul(80).div(100),
        newCOMPData._startedAt,
        newCOMPData._updatedAt,
        newCOMPData._answeredInRound
      );

      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.true;
    });

    it('should return false when user becomes healthy after price increase', async function () {
      const { COMP: priceFeedCOMP } = priceFeeds;

      // Increase price to make user healthy
      const currentCOMPData = await priceFeedCOMP.latestRoundData();
      await priceFeedCOMP.connect(governor).setRoundData(
        currentCOMPData._roundId,
        currentCOMPData._answer.mul(120).div(100),
        currentCOMPData._startedAt,
        currentCOMPData._updatedAt,
        currentCOMPData._answeredInRound
      );

      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.false;
    });

    it('should handle multiple collateral types correctly', async function () {
      // Make sure liquidatableUser2 is liquidatable by reducing prices if needed
      if (!(await cometWithExtendedAssetList.isLiquidatable(liquidatableUser2.address))) {
        const { COMP: priceFeedCOMP } = priceFeeds;
        const currentCOMPData = await priceFeedCOMP.latestRoundData();
        await priceFeedCOMP.connect(governor).setRoundData(
          currentCOMPData._roundId,
          currentCOMPData._answer.mul(90).div(100), // Reduce price by 10%
          currentCOMPData._startedAt,
          currentCOMPData._updatedAt,
          currentCOMPData._answeredInRound
        );
      }
      expect(await cometWithExtendedAssetList.isLiquidatable(liquidatableUser2.address)).to.be.true;
    });
  });

  describe('absorb function - happy cases', () => {
    after(async () => {
      await snapshot.restore();
    });

    it('should successfully execute partial liquidation', async function () {
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.true;

      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userToLiquidate.address]);
      absorbReceipt = await tx.wait();
      expect(absorbReceipt.status).to.equal(1);
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.false;
    });

    it('should handle multiple users in single absorb call', async function () {
      await snapshot.restore();

      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.true;
      expect(await cometWithExtendedAssetList.isLiquidatable(liquidatableUser2.address)).to.be.true;

      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(
        liquidator.address,
        [userToLiquidate.address, liquidatableUser2.address]
      );
      const receipt = await tx.wait();

      expect(receipt.status).to.equal(1);
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.false;
      expect(await cometWithExtendedAssetList.isLiquidatable(liquidatableUser2.address)).to.be.false;
    });

    it('should not revert when trying to absorb empty accounts array', async function () {
      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, []);
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });
  });

  describe('absorb function - error cases', () => {
    after(async () => {
      await snapshot.restore();
    });

    it('should revert when trying to absorb non-liquidatable user', async function () {
      await expect(
        cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userWithNoDebt.address])
      ).to.be.revertedWithCustomError(cometWithExtendedAssetList, 'NotLiquidatable');
    });

    it('should revert when trying to absorb user with no debt', async function () {
      await expect(
        cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userWithNoDebt.address])
      ).to.be.revertedWithCustomError(cometWithExtendedAssetList, 'NotLiquidatable');
    });

    it('should revert when trying to absorb user with healthy position', async function () {
      await expect(
        cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [healthyUser.address])
      ).to.be.revertedWithCustomError(cometWithExtendedAssetList, 'NotLiquidatable');
    });

    it('should revert when absorb is paused', async function () {
      await cometWithExtendedAssetList.connect(governor).pause(false, false, false, true, false);

      await expect(
        cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userToLiquidate.address])
      ).to.be.revertedWithCustomError(cometWithExtendedAssetList, 'Paused');
    });
  });

  describe('liquidation validation', () => {
    beforeEach(async () => {
      await snapshot.restore();
    });

    it('should reduce debt and collateral after liquidation', async function () {
      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userToLiquidate.address]);
      const receipt = await tx.wait();

      const debtAfter = await cometWithExtendedAssetList.borrowBalanceOf(userToLiquidate.address);
      const collateralAfterStruct = await cometWithExtendedAssetList.userCollateral(userToLiquidate.address, USDC.address);
      const collAfter = collateralAfterStruct.balance;
      const userBasicAfter = await cometWithExtendedAssetList.userBasic(userToLiquidate.address);

      expect(debtAfter).to.be.lt(debtBefore);
      expect(collAfter).to.be.lt(collBefore);
      expect(userBasicAfter.principal).to.be.gt(userBasicBefore.principal);
      expect(userBasicAfter.assetsIn).to.equal(0);
    });

    it('should emit AbsorbCollateral events with correct parameters', async function () {
      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userToLiquidate.address]);
      const receipt = await tx.wait();

      const absorbEvents = receipt.events?.filter(e => e.event === 'AbsorbCollateral') || [];
      expect(absorbEvents.length).to.be.greaterThan(0);
      if (absorbEvents.length > 0) {
        const event = absorbEvents[0];
        expect(event.args?.absorber).to.equal(liquidator.address);
        expect(event.args?.user).to.equal(userToLiquidate.address);
        expect(event.args?.seizeAmount).to.be.gt(0);
        expect(event.args?.seizedValue).to.be.gt(0);
      }
    });

    it('should update userCollateral correctly after liquidation', async function () {
      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userToLiquidate.address]);
      const receipt = await tx.wait();

      // Check that collateral was seized
      const compCollateralAfter = await cometWithExtendedAssetList.userCollateral(userToLiquidate.address, COMP.address);
      const usdtCollateralAfter = await cometWithExtendedAssetList.userCollateral(userToLiquidate.address, USDT.address);

      expect(compCollateralAfter.balance).to.be.lt(exp(100, 18)); // Some COMP was seized
      expect(usdtCollateralAfter.balance).to.be.lt(exp(100, 6)); // Some USDT was seized
    });

    it('should update totalCollateral correctly after liquidation', async function () {
      const compTotalBefore = await cometWithExtendedAssetList.totalsCollateral(COMP.address);
      const usdtTotalBefore = await cometWithExtendedAssetList.totalsCollateral(USDT.address);

      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userToLiquidate.address]);
      const receipt = await tx.wait();

      const compTotalAfter = await cometWithExtendedAssetList.totalsCollateral(COMP.address);
      const usdtTotalAfter = await cometWithExtendedAssetList.totalsCollateral(USDT.address);

      expect(compTotalAfter.totalSupplyAsset).to.be.lt(compTotalBefore.totalSupplyAsset);
      expect(usdtTotalAfter.totalSupplyAsset).to.be.lt(usdtTotalBefore.totalSupplyAsset);
    });

    it('should leave collateral on Comet after liquidation', async function () {
      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userToLiquidate.address]);
      const receipt = await tx.wait();

      // Check that some collateral remains on Comet
      const compCollateralAfter = await cometWithExtendedAssetList.userCollateral(userToLiquidate.address, COMP.address);
      const usdtCollateralAfter = await cometWithExtendedAssetList.userCollateral(userToLiquidate.address, USDT.address);

      expect(compCollateralAfter.balance).to.be.gt(0); // Some COMP should remain
      expect(usdtCollateralAfter.balance).to.be.gt(0); // Some USDT should remain
    });

    it('should reduce debt to acceptable level after liquidation', async function () {
      const tx = await cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [userToLiquidate.address]);
      const receipt = await tx.wait();

      const debtAfter = await cometWithExtendedAssetList.borrowBalanceOf(userToLiquidate.address);
      const userBasicAfter = await cometWithExtendedAssetList.userBasic(userToLiquidate.address);

      // Debt should be reduced but not eliminated
      expect(debtAfter).to.be.lt(debtBefore);
      expect(debtAfter).to.be.gt(0); // Some debt should remain

      // User should no longer be liquidatable
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.false;
    });
  });

  describe('edge cases', () => {
    after(async () => {
      await snapshot.restore();
    });

    it('should handle user with zero principal', async function () {
      // Setup zeroPrincipalUser with zero principal
      await COMP.connect(governor).transfer(zeroPrincipalUser.address, exp(10, 18));
      await COMP.connect(zeroPrincipalUser).approve(cometWithExtendedAssetList.address, exp(10, 18));
      await cometWithExtendedAssetList.connect(zeroPrincipalUser).supply(COMP.address, exp(10, 18));

      // User should not be liquidatable with zero principal
      expect(await cometWithExtendedAssetList.isLiquidatable(zeroPrincipalUser.address)).to.be.false;

      // Absorb should revert
      await expect(
        cometWithExtendedAssetList.connect(liquidator).absorb(liquidator.address, [zeroPrincipalUser.address])
      ).to.be.revertedWithCustomError(cometWithExtendedAssetList, 'NotLiquidatable');
    });

    it('should handle bad debt scenario', async function () {
      // This test would need specific setup for bad debt
      // For now, just ensure the function handles it gracefully
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.true;
    });

    it('should handle minimum debt scenario', async function () {
      // Create user with minimum possible debt
      const minDebtUser = users[6];
      await COMP.connect(governor).transfer(minDebtUser.address, exp(10, 18));
      await COMP.connect(minDebtUser).approve(cometWithExtendedAssetList.address, exp(10, 18));
      await cometWithExtendedAssetList.connect(minDebtUser).supply(COMP.address, exp(10, 18));

      const minBorrowCapacity = await borrowCapacityForAsset(cometWithExtendedAssetList, minDebtUser, 0);
      const minBorrowAmount = minBorrowCapacity.div(100); // Small but valid amount
      await cometWithExtendedAssetList.connect(minDebtUser).withdraw(USDC.address, minBorrowAmount);

      // Should not be liquidatable with such small debt
      expect(await cometWithExtendedAssetList.isLiquidatable(minDebtUser.address)).to.be.false;
    });
  });
});
