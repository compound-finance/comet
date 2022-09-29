import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { exp } from '../test/helpers';
import { isRewardSupported } from './utils';

function calculateRewardsOwed(
  userBalance: bigint,
  totalBalance: bigint,
  speed: bigint,
  timeElapsed: number,
  trackingIndexScale: bigint,
  rewardTokenScale: bigint,
  rescaleFactor: bigint
): bigint {
  // accrued = (user balance / total balance) * (speed / trackingIndexScale) * time * reward token scale
  const accrued = userBalance * speed * BigInt(timeElapsed) * rewardTokenScale / totalBalance / trackingIndexScale;
  // truncate using rescaleFactor
  return accrued / rescaleFactor * rescaleFactor;
}

scenario(
  'Comet#rewards > can claim supply rewards for self',
  {
    filter: async (ctx) => await isRewardSupported(ctx),
    tokenBalances: {
      albert: { $base: ' == 1000000' }, // in units of asset, not wei
    },
  },
  async ({ comet, rewards, actors }, context, world) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();

    const [rewardTokenAddress, rescaleFactor] = await rewards.rewardConfig(comet.address);
    const rewardToken = context.getAssetByAddress(rewardTokenAddress);
    const rewardScale = exp(1, await rewardToken.decimals());

    await baseAsset.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: 1_000_000n * baseScale });

    expect(await rewardToken.balanceOf(albert.address)).to.be.equal(0n);

    const supplyTimestamp = await world.timestamp();
    const albertBalance = await albert.getCometBaseBalance();
    const totalSupplyBalance = (await comet.totalSupply()).toBigInt();

    await world.increaseTime(86400); // fast forward a day
    const preTxnTimestamp = await world.timestamp();

    const rewardsOwedBefore = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();
    const txn = await (await rewards.connect(albert.signer).claim(comet.address, albert.address, true)).wait();
    const rewardsOwedAfter = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();

    const postTxnTimestamp = await world.timestamp();
    const timeElapsed = postTxnTimestamp - preTxnTimestamp;

    const supplySpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
    const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
    const timestampDelta = preTxnTimestamp - supplyTimestamp;
    const totalSupplyPrincipal = (await comet.totalsBasic()).totalSupplyBase.toBigInt();
    const baseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
    let expectedRewardsOwed = 0n;
    let expectedRewardsReceived = 0n;
    if (totalSupplyPrincipal >= baseMinForRewards) {
      expectedRewardsOwed = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
      expectedRewardsReceived = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta + timeElapsed, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
    }

    // Occasionally `timestampDelta` is equal to 86401
    expect(timestampDelta).to.be.greaterThanOrEqual(86400);
    expect(rewardsOwedBefore).to.be.equal(expectedRewardsOwed);
    expect(await rewardToken.balanceOf(albert.address)).to.be.equal(expectedRewardsReceived);
    expect(rewardsOwedAfter).to.be.equal(0n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#rewards > manager can claimTo supply rewards from a managed account',
  {
    filter: async (ctx) => await isRewardSupported(ctx),
    tokenBalances: {
      albert: { $base: ' == 1000000' }, // in units of asset, not wei
    },
  },
  async ({ comet, rewards, actors }, context, world) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();

    const [rewardTokenAddress, rescaleFactor] = await rewards.rewardConfig(comet.address);
    const rewardToken = context.getAssetByAddress(rewardTokenAddress);
    const rewardScale = exp(1, await rewardToken.decimals());

    await albert.allow(betty, true); // Albert allows Betty to manage his account
    await baseAsset.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: 1_000_000n * baseScale });

    expect(await rewardToken.balanceOf(albert.address)).to.be.equal(0n);

    const supplyTimestamp = await world.timestamp();
    const albertBalance = await albert.getCometBaseBalance();
    const totalSupplyBalance = (await comet.totalSupply()).toBigInt();

    await world.increaseTime(86400); // fast forward a day
    const preTxnTimestamp = await world.timestamp();

    const rewardsOwedBefore = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();
    const txn = await (await rewards.connect(betty.signer).claimTo(comet.address, albert.address, betty.address, true)).wait();
    const rewardsOwedAfter = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();

    const postTxnTimestamp = await world.timestamp();
    const timeElapsed = postTxnTimestamp - preTxnTimestamp;

    const supplySpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
    const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
    const timestampDelta = preTxnTimestamp - supplyTimestamp;
    const totalSupplyPrincipal = (await comet.totalsBasic()).totalSupplyBase.toBigInt();
    const baseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
    let expectedRewardsOwed = 0n;
    let expectedRewardsReceived = 0n;
    if (totalSupplyPrincipal >= baseMinForRewards) {
      expectedRewardsOwed = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
      expectedRewardsReceived = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta + timeElapsed, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
    }

    // Occasionally `timestampDelta` is equal to 86401
    expect(timestampDelta).to.be.greaterThanOrEqual(86400);
    expect(rewardsOwedBefore).to.be.equal(expectedRewardsOwed);
    expect(await rewardToken.balanceOf(betty.address)).to.be.equal(expectedRewardsReceived);
    expect(rewardsOwedAfter).to.be.equal(0n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#rewards > can claim borrow rewards for self',
  {
    filter: async (ctx) => await isRewardSupported(ctx),
    tokenBalances: {
      albert: { $asset0: ' == 10000' }, // in units of asset, not wei
      $comet: { $base: ' >= 1000 ' }
    },
  },
  async ({ comet, rewards, actors }, context, world) => {
    const { albert } = actors;
    const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const scale = scaleBN.toBigInt();
    const toSupply = 10_000n * scale;
    const baseAssetAddress = await comet.baseToken();
    const baseScale = (await comet.baseScale()).toBigInt();
    const toBorrow = 1_000n * baseScale;

    const [rewardTokenAddress, rescaleFactor] = await rewards.rewardConfig(comet.address);
    const rewardToken = context.getAssetByAddress(rewardTokenAddress);
    const rewardScale = exp(1, await rewardToken.decimals());

    await collateralAsset.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: collateralAssetAddress, amount: toSupply });
    await albert.withdrawAsset({ asset: baseAssetAddress, amount: toBorrow });

    expect(await rewardToken.balanceOf(albert.address)).to.be.equal(0n);

    const borrowTimestamp = await world.timestamp();
    const albertBalance = await albert.getCometBaseBalance();
    const totalBorrowBalance = (await comet.totalBorrow()).toBigInt();

    await world.increaseTime(86400); // fast forward a day
    const preTxnTimestamp = await world.timestamp();

    const rewardsOwedBefore = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();
    const txn = await (await rewards.connect(albert.signer).claim(comet.address, albert.address, true)).wait();
    const rewardsOwedAfter = (await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed.toBigInt();

    const postTxnTimestamp = await world.timestamp();
    const timeElapsed = postTxnTimestamp - preTxnTimestamp;

    const borrowSpeed = (await comet.baseTrackingBorrowSpeed()).toBigInt();
    const trackingIndexScale = (await comet.trackingIndexScale()).toBigInt();
    const timestampDelta = preTxnTimestamp - borrowTimestamp;
    const totalBorrowPrincipal = (await comet.totalsBasic()).totalBorrowBase.toBigInt();
    const baseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
    let expectedRewardsOwed = 0n;
    let expectedRewardsReceived = 0n;
    if (totalBorrowPrincipal >= baseMinForRewards) {
      expectedRewardsOwed = calculateRewardsOwed(-albertBalance, totalBorrowBalance, borrowSpeed, timestampDelta, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
      expectedRewardsReceived = calculateRewardsOwed(-albertBalance, totalBorrowBalance, borrowSpeed, timestampDelta + timeElapsed, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
    }

    // Occasionally `timestampDelta` is equal to 86401
    expect(timestampDelta).to.be.greaterThanOrEqual(86400);
    expect(rewardsOwedBefore).to.be.equal(expectedRewardsOwed);
    expect(await rewardToken.balanceOf(albert.address)).to.be.equal(expectedRewardsReceived);
    expect(rewardsOwedAfter).to.be.equal(0n);

    return txn; // return txn to measure gas
  }
);