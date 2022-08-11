import { scenario } from './context/CometContext';
import { constants } from 'ethers';
import { expect } from 'chai';
import { exp } from '../test/helpers';

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
    // Pass this scenario if a rewardToken doesn't exist
    if (rewardTokenAddress === constants.AddressZero) return;
    const rewardToken = context.getAssetByAddress(rewardTokenAddress);
    const rewardScale = exp(1, await rewardToken.decimals());

    expect(await rewardToken.balanceOf(albert.address)).to.be.equal(0n);

    await baseAsset.approve(albert, comet.address);
    await albert.supplyAsset({ asset: baseAssetAddress, amount: 1_000_000n * baseScale })

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
    const expectedRewardsOwed = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
    const expectedRewardsReceived = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta + timeElapsed, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());

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
    // Pass this scenario if a rewardToken doesn't exist
    if (rewardTokenAddress === constants.AddressZero) return;
    const rewardToken = context.getAssetByAddress(rewardTokenAddress);
    const rewardScale = exp(1, await rewardToken.decimals());

    expect(await rewardToken.balanceOf(albert.address)).to.be.equal(0n);

    await albert.allow(betty, true); // Albert allows Betty to manage his account
    await baseAsset.approve(albert, comet.address);
    await albert.supplyAsset({ asset: baseAssetAddress, amount: 1_000_000n * baseScale });

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
    const expectedRewardsOwed = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());
    const expectedRewardsReceived = calculateRewardsOwed(albertBalance, totalSupplyBalance, supplySpeed, timestampDelta + timeElapsed, trackingIndexScale, rewardScale, rescaleFactor.toBigInt());

    // Occasionally `timestampDelta` is equal to 86401
    expect(timestampDelta).to.be.greaterThanOrEqual(86400);
    expect(rewardsOwedBefore).to.be.equal(expectedRewardsOwed);
    expect(await rewardToken.balanceOf(betty.address)).to.be.equal(expectedRewardsReceived);
    expect(rewardsOwedAfter).to.be.equal(0n);

    return txn; // return txn to measure gas
  }
);

// XXX add borrow side rewards, which is trickier because of supply caps