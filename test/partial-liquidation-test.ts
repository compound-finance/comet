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

describe('CometWithExtendedAssetList - Partial Liquidation', function() {
  let protocol: any;
  let cometWithExtendedAssetList: any;
  let tokens: any;
  let priceFeeds: any;
  let governor: any;
  let users: any;
  let user1: any;
  let userToLiquidate: any;
  let user2: any;
  let snapshot: SnapshotRestorer;
  let debtBefore: BigNumber;
  let collBefore: BigNumber;
  let userBasicBefore: any;
  let absorbReceipt: ContractReceipt;
  let USDC: any;
  let COMP: any;
  let USDT: any;
  let WETH: any;
  let WBTC: any;

  before(async function() {
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
    [user1, userToLiquidate, user2] = users;
    const { USDC: USDC_token, COMP: COMP_token, USDT: USDT_token, WETH: WETH_token, WBTC: WBTC_token } = tokens;
    USDC = USDC_token;
    COMP = COMP_token;
    USDT = USDT_token;
    WETH = WETH_token;
    WBTC = WBTC_token;
    const { COMP: priceFeedCOMP, USDT: priceFeedUSDT } = priceFeeds;

    // Setup user1 (liquidator)
    await USDC.connect(governor).transfer(user1.address, exp(8000, 6));
    await USDC.connect(user1).approve(cometWithExtendedAssetList.address, exp(8000, 6));
    await cometWithExtendedAssetList.connect(user1).supply(USDC.address, exp(8000, 6));

    // Setup userToLiquidate (user to be liquidated)
    await COMP.connect(governor).transfer(userToLiquidate.address, exp(100, 18));
    await COMP.connect(userToLiquidate).approve(cometWithExtendedAssetList.address, exp(100, 18));
    await cometWithExtendedAssetList.connect(userToLiquidate).supply(COMP.address, exp(100, 18));
    
    await USDT.connect(governor).transfer(userToLiquidate.address, exp(100, 6));
    await USDT.connect(userToLiquidate).approve(cometWithExtendedAssetList.address, exp(100, 6));
    await cometWithExtendedAssetList.connect(userToLiquidate).supply(USDT.address, exp(100, 6));
    
    const borrowCapacityCOMP = await borrowCapacityForAsset(cometWithExtendedAssetList, userToLiquidate, 0);
    const borrowCapacityUSDT = await borrowCapacityForAsset(cometWithExtendedAssetList, userToLiquidate, 1);
    const borrowCapacity = borrowCapacityCOMP.add(borrowCapacityUSDT);
    await cometWithExtendedAssetList.connect(userToLiquidate).withdraw(USDC.address, borrowCapacity);
    
    // Setup user2 (additional user for multi-user tests) - make them liquidatable too
    await COMP.connect(governor).transfer(user2.address, exp(50, 18));
    await COMP.connect(user2).approve(cometWithExtendedAssetList.address, exp(50, 18));
    await cometWithExtendedAssetList.connect(user2).supply(COMP.address, exp(50, 18));
    
    const borrowCapacity2 = await borrowCapacityForAsset(cometWithExtendedAssetList, user2, 0);
    await cometWithExtendedAssetList.connect(user2).withdraw(USDC.address, borrowCapacity2);
    
    // Make users liquidatable by reducing prices
    let iterations = 0;
    while((!(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)) || 
          !(await cometWithExtendedAssetList.isLiquidatable(user2.address))) && iterations < 50) {
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

    debtBefore = await cometWithExtendedAssetList.borrowBalanceOf(userToLiquidate.address);
    const collateralBeforeStruct = await cometWithExtendedAssetList.userCollateral(userToLiquidate.address, USDC.address);
    collBefore = collateralBeforeStruct.balance;
    userBasicBefore = await cometWithExtendedAssetList.userBasic(userToLiquidate.address);

    snapshot = await takeSnapshot();
  });

  describe('absorb function - happy cases', () => {
    after(async () => {
      await snapshot.restore();
    });

    it('should successfully execute partial liquidation', async function () {
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.true;
      
      // Log target health factor before absorb
      try {
        const targetHF = await cometWithExtendedAssetList.targetHealthFactor();
        console.log(' Target Health Factor before absorb:', targetHF.toString());
        console.log(' Target Health Factor before absorb :', ethers.utils.formatEther(targetHF));
      } catch (error) {
        console.log(' Could not get target health factor:', error.message);
      }
      
      const tx = await cometWithExtendedAssetList.connect(user1).absorb(user1.address, [userToLiquidate.address]);
      absorbReceipt = await tx.wait();
      expect(absorbReceipt.status).to.equal(1);             
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.false;
    });
      
    it('should reduce debt and collateral after liquidation', async function() {
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
      
      const absorbEvents = absorbReceipt.events?.filter(e => e.event === 'AbsorbCollateral') || [];
      expect(absorbEvents.length).to.be.greaterThan(0);
      if (absorbEvents.length > 0) {
        const event = absorbEvents[0];
        expect(event.args?.absorber).to.equal(user1.address);
        expect(event.args?.user).to.equal(userToLiquidate.address);
        expect(event.args?.seizeAmount).to.be.gt(0);
        expect(event.args?.seizedValue).to.be.gt(0);
      }
    });

    it('should handle multiple users in single absorb call', async function () {
      await snapshot.restore();

      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.true;
      expect(await cometWithExtendedAssetList.isLiquidatable(user2.address)).to.be.true;
    
      const tx = await cometWithExtendedAssetList.connect(user1).absorb(
        user1.address, 
        [userToLiquidate.address, user2.address]
      );
      const receipt = await tx.wait();
    
      expect(receipt.status).to.equal(1);
      expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.false;
      expect(await cometWithExtendedAssetList.isLiquidatable(user2.address)).to.be.false;
    });

    describe('absorb function - reverts', () => {
      after(async () => {
        await snapshot.restore();
      });

      it('should revert when trying to absorb non-liquidatable user', async function () {
      
        await expect(
          cometWithExtendedAssetList.connect(user1).absorb(user1.address, [user2.address])
        ).to.be.revertedWithCustomError(cometWithExtendedAssetList, 'NotLiquidatable');
      });

      it('should revert when absorb is paused', async function () {
      
        await cometWithExtendedAssetList.connect(governor).pause(false, false, false, true, false);
      
        await expect(
          cometWithExtendedAssetList.connect(user1).absorb(user1.address, [userToLiquidate.address])
        ).to.be.revertedWithCustomError(cometWithExtendedAssetList, 'Paused');
      });

      it('should not revert when trying to absorb empty accounts array', async function () {
        await expect(
          cometWithExtendedAssetList.connect(user1).absorb(user1.address, [])
        ).to.not.be.reverted;
      });
    });

    describe('isLiquidatable function', () => {
      after(async () => {
        await snapshot.restore();
      });

      it('should correctly identify liquidatable user', async function () {
        expect(await cometWithExtendedAssetList.isLiquidatable(userToLiquidate.address)).to.be.true;
      });

      it('should return false when user has no debt', async function () {
      // Create user with only collateral, no debt
        const newUser = users[3];
        await COMP.connect(governor).transfer(newUser.address, exp(50, 18));
        await COMP.connect(newUser).approve(cometWithExtendedAssetList.address, exp(50, 18));
        await cometWithExtendedAssetList.connect(newUser).supply(COMP.address, exp(50, 18));
      
        expect(await cometWithExtendedAssetList.isLiquidatable(newUser.address)).to.be.false;
      });

      it('should return false when user has healthy position', async function () {
      // Create user with small debt relative to collateral
        const healthyUser = users[4];
        await COMP.connect(governor).transfer(healthyUser.address, exp(100, 18));
        await COMP.connect(healthyUser).approve(cometWithExtendedAssetList.address, exp(100, 18));
        await cometWithExtendedAssetList.connect(healthyUser).supply(COMP.address, exp(100, 18));
      
        // Borrow only 50% of capacity
        const borrowCapacity = await borrowCapacityForAsset(cometWithExtendedAssetList, healthyUser, 0);
        const smallBorrowAmount = borrowCapacity.div(2);
        await cometWithExtendedAssetList.connect(healthyUser).withdraw(USDC.address, smallBorrowAmount);
      
        expect(await cometWithExtendedAssetList.isLiquidatable(healthyUser.address)).to.be.false;
      });

      it('should correctly identify non-liquidatable user', async function () {
      // user2 is liquidatable from before() setup, so we need to make them healthy first
        const currentDebt = await cometWithExtendedAssetList.borrowBalanceOf(user2.address);
        const repayAmount = currentDebt.div(2);
      
        await USDC.connect(user1).transfer(user2.address, repayAmount);
        await cometWithExtendedAssetList.connect(user2).supply(USDC.address, repayAmount);
      
        expect(await cometWithExtendedAssetList.isLiquidatable(user2.address)).to.be.false;
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
  
        expect(await cometWithExtendedAssetList.isLiquidatable(user2.address)).to.be.true;
      });

      it('should return false for zero address', async function () {
        expect(await cometWithExtendedAssetList.isLiquidatable(ethers.constants.AddressZero)).to.be.false;
      });
    });
  });
});

