import { scenario } from './context/CometContext';
import { constants, utils } from 'ethers';
import { expect } from 'chai';
import { isRewardSupported, isBulkerSupported, getExpectedBaseBalance } from './utils';
import { exp } from '../test/helpers';

scenario(
  'Comet#bulker > all non-reward actions in one txn',
  {
    filter: async (ctx) => await isBulkerSupported(ctx),
    tokenBalances: {
      albert: { $base: '== 0', $asset0: 3000 },
      $comet: { $base: 5000 },
    },
  },
  async ({ comet, actors, assets, bulker }, context) => {
    const { albert, betty } = actors;
    const { WETH } = assets;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const toSupplyCollateral = 3000n * collateralScale;
    const toBorrowBase = 1500n * baseScale;
    const toTransferBase = 500n * baseScale;
    const toSupplyEth = exp(0.01, 18);
    const toWithdrawEth = exp(0.005, 18);

    // Approvals
    await collateralAsset.approve(albert, comet.address);
    await albert.allow(bulker.address, true);

    // Initial expectations
    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(0n);

    // Albert's actions:
    // 1. Supplies 3000 units of collateral
    // 2. Borrows 1500 base
    // 3. Transfers 500 base to Betty
    // 4. Supplies 0.01 ETH
    // 5. Withdraws 0.005 ETH
    const supplyAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, albert.address, collateralAsset.address, toSupplyCollateral]);
    const withdrawAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, albert.address, baseAsset.address, toBorrowBase]);
    const transferAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, betty.address, baseAsset.address, toTransferBase]);
    const supplyEthCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, albert.address, toSupplyEth]);
    const withdrawEthCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, albert.address, toWithdrawEth]);
    const calldata = [
      supplyAssetCalldata,
      withdrawAssetCalldata,
      transferAssetCalldata,
      supplyEthCalldata,
      withdrawEthCalldata
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET(),
      await bulker.ACTION_SUPPLY_ETH(),
      await bulker.ACTION_WITHDRAW_ETH(),
    ];
    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    expect(await comet.balanceOf(betty.address)).to.be.equal(baseTransferred);
    expect(await comet.borrowBalanceOf(albert.address)).to.be.equal(toBorrowBase + toTransferBase);
    expect(await comet.collateralBalanceOf(albert.address, WETH.address)).to.be.equal(toSupplyEth - toWithdrawEth);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#bulker > all actions in one txn',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) && await isRewardSupported(ctx),
    tokenBalances: {
      albert: { $base: '== 1000000', $asset0: 100 },
      $comet: { $base: 5000 },
    },
  },
  async ({ comet, actors, assets, rewards, bulker }, context, world) => {
    const { albert, betty } = actors;
    const { WETH } = assets;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const [rewardTokenAddress] = await rewards.rewardConfig(comet.address);
    const toSupplyCollateral = 100n * collateralScale;
    const toBorrowBase = 1500n * baseScale;
    const toTransferBase = 500n * baseScale;
    const toSupplyEth = exp(0.01, 18);
    const toWithdrawEth = exp(0.005, 18);

    // Approvals
    await baseAsset.approve(albert, comet.address);
    await collateralAsset.approve(albert, comet.address);
    await albert.allow(bulker.address, true);

    // Accrue some rewards to Albert, then transfer away Albert's supplied base
    await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: 1_000_000n * baseScale });
    await world.increaseTime(86400); // fast forward a day
    await albert.transferAsset({ dst: constants.AddressZero, asset: baseAssetAddress, amount: constants.MaxUint256 }); // transfer all base away

    // Initial expectations
    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(0n);
    const startingRewardBalance = await albert.getErc20Balance(rewardTokenAddress);
    const rewardOwed = ((await rewards.callStatic.getRewardOwed(comet.address, albert.address)).owed).toBigInt();
    const expectedFinalRewardBalance = collateralAssetAddress === rewardTokenAddress ?
      startingRewardBalance + rewardOwed - toSupplyCollateral :
      startingRewardBalance + rewardOwed;

    // Albert's actions:
    // 1. Supplies 100 units of collateral
    // 2. Borrows 1500 base
    // 3. Transfers 500 base to Betty
    // 4. Supplies 0.01 ETH
    // 5. Withdraws 0.005 ETH
    // 6. Claim rewards
    const supplyAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, albert.address, collateralAsset.address, toSupplyCollateral]);
    const withdrawAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, albert.address, baseAsset.address, toBorrowBase]);
    const transferAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, betty.address, baseAsset.address, toTransferBase]);
    const supplyEthCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, albert.address, toSupplyEth]);
    const withdrawEthCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, albert.address, toWithdrawEth]);
    const claimRewardCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'bool'], [comet.address, rewards.address, albert.address, true]);
    const calldata = [
      supplyAssetCalldata,
      withdrawAssetCalldata,
      transferAssetCalldata,
      supplyEthCalldata,
      withdrawEthCalldata,
      claimRewardCalldata
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET(),
      await bulker.ACTION_SUPPLY_ETH(),
      await bulker.ACTION_WITHDRAW_ETH(),
      await bulker.ACTION_CLAIM_REWARD(),
    ];
    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    expect(await comet.balanceOf(betty.address)).to.be.equal(baseTransferred);
    expect(await comet.borrowBalanceOf(albert.address)).to.be.equal(toBorrowBase + toTransferBase);
    expect(await comet.collateralBalanceOf(albert.address, WETH.address)).to.be.equal(toSupplyEth - toWithdrawEth);
    expect(await albert.getErc20Balance(rewardTokenAddress)).to.be.equal(expectedFinalRewardBalance);

    return txn; // return txn to measure gas
  }
);
