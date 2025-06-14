import { CometContext, scenario } from './context/CometContext';
import { constants, utils } from 'ethers';
import { expect } from 'chai';
import { expectBase, isRewardSupported, isBulkerSupported, getExpectedBaseBalance, matchesDeployment } from './utils';
import { exp } from '../test/helpers';
import { getConfigForScenario } from './utils/scenarioHelper';

async function hasNativeAsCollateralOrBase(ctx: CometContext): Promise<boolean> {
  const comet = await ctx.getComet();
  const bulker = await ctx.getBulker();
  const wrappedNativeToken = await bulker.wrappedNativeToken();
  if ((await comet.baseToken()).toLowerCase() === wrappedNativeToken.toLowerCase()) return true;
  const numAssets = await comet.numAssets();
  for (let i = 0; i < numAssets; i++) {
    const { asset } = await comet.getAssetInfo(i);
    if (asset.toLowerCase() === wrappedNativeToken.toLowerCase()) {
      return true;
    }
  }
}

scenario(
  'Comet#bulker > (non-WETH base) all non-reward actions in one txn for single asset',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) && (!matchesDeployment(ctx, [{ deployment: 'weth' }, { deployment: 'wsteth' }, { network: 'ronin', deployment: 'wron'}])),
    supplyCaps: async (ctx) =>  (
      {
        $asset0: getConfigForScenario(ctx).bulkerAsset,
        $asset1: getConfigForScenario(ctx).bulkerAsset1,
      }
    ),
    tokenBalances: async (ctx) =>  (
      {
        albert: {
          $base: '== 0',
          $asset0: getConfigForScenario(ctx).bulkerAsset,
          $asset1: getConfigForScenario(ctx).bulkerAsset1
        },
        $comet: { $base: getConfigForScenario(ctx).bulkerComet },
      }
    ),
  },
  async ({ comet, actors, bulker }, context) => {
    const { albert, betty } = actors;
    const wrappedNativeToken = await bulker.wrappedNativeToken();
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    // if asset 0 is native token we took asset 1
    const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const toSupplyCollateral = BigInt(getConfigForScenario(context).bulkerAsset) * collateralScale;
    const toBorrowBase = BigInt(getConfigForScenario(context).bulkerBorrowBase) * baseScale;
    const toTransferBase = BigInt(getConfigForScenario(context).bulkerBorrowAsset) * baseScale;
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
    // 2. Borrows 1000 base
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
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET(),
    ];

    if (await hasNativeAsCollateralOrBase(context)) {
      calldata.push(supplyEthCalldata);
      calldata.push(withdrawEthCalldata);
      actions.push(await bulker.ACTION_SUPPLY_NATIVE_TOKEN());
      actions.push(await bulker.ACTION_WITHDRAW_NATIVE_TOKEN());
    }

    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    if (await hasNativeAsCollateralOrBase(context)) expect(await comet.collateralBalanceOf(albert.address, wrappedNativeToken)).to.be.equal(toSupplyEth - toWithdrawEth);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    expectBase((await comet.balanceOf(betty.address)).toBigInt(), baseTransferred);
    expectBase((await comet.borrowBalanceOf(albert.address)).toBigInt(), toBorrowBase + toTransferBase);

    return txn; // return txn to measure gas
  }
);

// XXX properly handle cases where asset0 is WETH
scenario(
  'Comet#bulker > (non-WETH base) all non-reward actions in one txn',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) && !matchesDeployment(ctx, [{ deployment: 'weth' }, { deployment: 'wsteth' }, { network: 'ronin', deployment: 'wron'}]),
    supplyCaps: async (ctx) => (
      {
        $asset0: getConfigForScenario(ctx).bulkerAsset,
        $asset1: getConfigForScenario(ctx).bulkerAsset1,
      }
    ),
    tokenBalances: async (ctx) => (
      {
        albert: {
          $base: '== 0',
          $asset0: getConfigForScenario(ctx).bulkerAsset,
          $asset1: getConfigForScenario(ctx).bulkerAsset1
        },
        $comet: { $base: getConfigForScenario(ctx).bulkerComet },
      }
    ),
  },
  async ({ comet, actors, bulker }, context) => {
    const { albert, betty } = actors;
    const wrappedNativeToken = await bulker.wrappedNativeToken();
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    // if asset 0 is native token we took asset 1
    const { asset: asset0, scale: scale0 } = await comet.getAssetInfo(0);
    const { asset: asset1, scale: scale1 } = await comet.getAssetInfo(1);
    const { asset: collateralAssetAddress, scale: scaleBN } = asset0 === wrappedNativeToken ? { asset: asset1, scale: scale1 } : { asset: asset0, scale: scale0 };
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const toSupplyCollateral = BigInt(asset0 === wrappedNativeToken ? getConfigForScenario(context).bulkerAsset1 : getConfigForScenario(context).bulkerAsset) * collateralScale;
    const toBorrowBase = BigInt(getConfigForScenario(context).bulkerBorrowBase) * baseScale;
    const toTransferBase = BigInt(getConfigForScenario(context).bulkerBorrowAsset) * baseScale;
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
    // 2. Borrows 1000 base
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
      transferAssetCalldata
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET()
    ];

    if (await hasNativeAsCollateralOrBase(context)) {
      calldata.push(supplyEthCalldata);
      calldata.push(withdrawEthCalldata);
      actions.push(await bulker.ACTION_SUPPLY_NATIVE_TOKEN());
      actions.push(await bulker.ACTION_WITHDRAW_NATIVE_TOKEN());
    }

    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    if (await hasNativeAsCollateralOrBase(context)) expect(await comet.collateralBalanceOf(albert.address, wrappedNativeToken)).to.be.equal(toSupplyEth - toWithdrawEth);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    expectBase((await comet.balanceOf(betty.address)).toBigInt(), baseTransferred);
    expectBase((await comet.borrowBalanceOf(albert.address)).toBigInt(), toBorrowBase + toTransferBase);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#bulker > (WETH base) all non-reward actions in one txn',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) &&
      matchesDeployment(ctx, [{ deployment: 'weth' }, { network: 'ronin', deployment: 'wron'}]) &&
      !matchesDeployment(ctx, [{ network: 'ronin', deployment: 'weth' }]),
    supplyCaps: async (ctx) => (
      {
        $asset0: getConfigForScenario(ctx).bulkerAsset,
      }
    ),
    tokenBalances: async (ctx) => (
      {
        albert: {
          $base: '== 0',
          $asset0: getConfigForScenario(ctx).bulkerAsset
        },
        $comet: { $base: getConfigForScenario(ctx).bulkerComet },
      }
    ),
  },
  async ({ comet, actors, bulker }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const toSupplyCollateral = BigInt(getConfigForScenario(context).bulkerAsset) * collateralScale;
    const toBorrowBase = BigInt(getConfigForScenario(context).bulkerBorrowBase) * baseScale;
    const toTransferBase = BigInt(getConfigForScenario(context).bulkerBorrowAsset) * baseScale;
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
    const supplyNativeTokenCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, albert.address, toSupplyEth]);
    const withdrawNativeTokenCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, albert.address, toWithdrawEth]);
    const calldata = [
      supplyAssetCalldata,
      withdrawAssetCalldata,
      transferAssetCalldata,
      supplyNativeTokenCalldata,
      withdrawNativeTokenCalldata
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET(),
      await bulker.ACTION_SUPPLY_NATIVE_TOKEN(),
      await bulker.ACTION_WITHDRAW_NATIVE_TOKEN(),
    ];
    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    expectBase((await comet.balanceOf(betty.address)).toBigInt(), baseTransferred);
    expectBase((await comet.borrowBalanceOf(albert.address)).toBigInt(), toBorrowBase + toTransferBase - (toSupplyEth - toWithdrawEth));

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#bulker > (non-WETH base) all actions in one txn for single asset',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) && await isRewardSupported(ctx) && (!matchesDeployment(ctx, [{ deployment: 'weth' }, { deployment: 'wsteth' }, { network: 'ronin', deployment: 'wron'}])),
    supplyCaps: async (ctx) =>  (
      {
        $asset0: getConfigForScenario(ctx).bulkerAsset,
        $asset1: getConfigForScenario(ctx).bulkerAsset1,
      }
    ),
    tokenBalances: async (ctx) =>  (
      {
        albert: {
          $base: `==  ${getConfigForScenario(ctx).bulkerBase}`,
          $asset0: getConfigForScenario(ctx).bulkerAsset,
          $asset1: getConfigForScenario(ctx).bulkerAsset1
        },
        $comet: { $base: getConfigForScenario(ctx).bulkerComet },
      }
    ),
  },
  async ({ comet, actors, rewards, bulker }, context, world) => {
    const { albert, betty } = actors;
    const wrappedNativeToken = await bulker.wrappedNativeToken();
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    // if asset 0 is native token we took asset 1
    const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const [rewardTokenAddress] = await rewards.rewardConfig(comet.address);
    const toSupplyBase = BigInt(getConfigForScenario(context).bulkerBase) * baseScale;
    const toSupplyCollateral = BigInt(getConfigForScenario(context).bulkerAsset) * collateralScale;
    const toBorrowBase = BigInt(getConfigForScenario(context).bulkerBorrowBase) * baseScale;
    const toTransferBase = BigInt(getConfigForScenario(context).bulkerBorrowAsset) * baseScale;
    const toSupplyEth = exp(0.01, 18);
    const toWithdrawEth = exp(0.005, 18);

    // Approvals
    await baseAsset.approve(albert, comet.address);
    await collateralAsset.approve(albert, comet.address);
    await albert.allow(bulker.address, true);

    // Accrue some rewards to Albert, then transfer away Albert's supplied base
    await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: toSupplyBase });
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
    // 1. Supplies 3000 units of collateral
    // 2. Borrows 1000 base
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
      claimRewardCalldata
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET(),
      await bulker.ACTION_CLAIM_REWARD(),
    ];

    if (await hasNativeAsCollateralOrBase(context)) {
      calldata.push(supplyEthCalldata);
      calldata.push(withdrawEthCalldata);
      actions.push(await bulker.ACTION_SUPPLY_NATIVE_TOKEN());
      actions.push(await bulker.ACTION_WITHDRAW_NATIVE_TOKEN());
    }

    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    if (await hasNativeAsCollateralOrBase(context)) expect(await comet.collateralBalanceOf(albert.address, wrappedNativeToken)).to.be.equal(toSupplyEth - toWithdrawEth);
    expect(await albert.getErc20Balance(rewardTokenAddress)).to.be.equal(expectedFinalRewardBalance);
    expectBase((await comet.balanceOf(betty.address)).toBigInt(), baseTransferred);
    expectBase((await comet.borrowBalanceOf(albert.address)).toBigInt(), toBorrowBase + toTransferBase);

    return txn; // return txn to measure gas
  }
);

// XXX properly handle cases where asset0 is WETH
scenario(
  'Comet#bulker > (non-WETH base) all actions in one txn',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) && await isRewardSupported(ctx) && !matchesDeployment(ctx, [{ deployment: 'weth' }, { deployment: 'wsteth' }, { network: 'base', deployment: 'usds' }, { deployment: 'wsteth' }, { network: 'ronin', deployment: 'wron'}]),
    supplyCaps: async (ctx) => (
      {
        $asset0: getConfigForScenario(ctx).bulkerAsset,
        $asset1: getConfigForScenario(ctx).bulkerAsset1,
      }
    ),
    tokenBalances: async (ctx) => (
      {
        albert: {
          $base: `==  ${getConfigForScenario(ctx).bulkerBase}`,
          $asset0: getConfigForScenario(ctx).bulkerAsset,
          $asset1: getConfigForScenario(ctx).bulkerAsset1
        },
        $comet: { $base: getConfigForScenario(ctx).bulkerComet },
      }
    ),
  },
  async ({ comet, actors, rewards, bulker }, context, world) => {
    const { albert, betty } = actors;
    const wrappedNativeToken = await bulker.wrappedNativeToken();
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    // if asset 0 is native token we took asset 1
    const { asset: asset0, scale: scale0 } = await comet.getAssetInfo(0);
    const { asset: asset1, scale: scale1 } = await comet.getAssetInfo(1);
    const { asset: collateralAssetAddress, scale: scaleBN } = asset0 === wrappedNativeToken ? { asset: asset1, scale: scale1 } : { asset: asset0, scale: scale0 };
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const [rewardTokenAddress] = await rewards.rewardConfig(comet.address);
    const toSupplyBase = BigInt(getConfigForScenario(context).bulkerBase) * baseScale;
    const toSupplyCollateral = BigInt(asset0 === wrappedNativeToken ? getConfigForScenario(context).bulkerAsset1 : getConfigForScenario(context).bulkerAsset) * collateralScale;
    const toBorrowBase = BigInt(getConfigForScenario(context).bulkerBorrowBase) * baseScale;
    const toTransferBase = BigInt(getConfigForScenario(context).bulkerBorrowAsset) * baseScale;
    const toSupplyEth = exp(0.01, 18);
    const toWithdrawEth = exp(0.005, 18);

    // Approvals
    await baseAsset.approve(albert, comet.address);
    await collateralAsset.approve(albert, comet.address);
    await albert.allow(bulker.address, true);

    // Accrue some rewards to Albert, then transfer away Albert's supplied base
    await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: toSupplyBase });
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
    // 1. Supplies 3000 units of collateral
    // 2. Borrows 1000 base
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
      claimRewardCalldata
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET(),
      await bulker.ACTION_CLAIM_REWARD(),
    ];

    if (await hasNativeAsCollateralOrBase(context)) {
      calldata.push(supplyEthCalldata);
      calldata.push(withdrawEthCalldata);
      actions.push(await bulker.ACTION_SUPPLY_NATIVE_TOKEN());
      actions.push(await bulker.ACTION_WITHDRAW_NATIVE_TOKEN());
    }

    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    if (await hasNativeAsCollateralOrBase(context)) expect(await comet.collateralBalanceOf(albert.address, wrappedNativeToken)).to.be.equal(toSupplyEth - toWithdrawEth);
    expect(await albert.getErc20Balance(rewardTokenAddress)).to.be.equal(expectedFinalRewardBalance);
    expectBase((await comet.balanceOf(betty.address)).toBigInt(), baseTransferred);
    expectBase((await comet.borrowBalanceOf(albert.address)).toBigInt(), toBorrowBase + toTransferBase);

    return txn; // return txn to measure gas
  }
);


scenario(
  'Comet#bulker > (wstETH base) all actions in one txn',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) && await isRewardSupported(ctx) && !matchesDeployment(ctx, [{ deployment: 'wsteth' }]),
    supplyCaps: async (ctx) =>  (
      {
        $asset0: getConfigForScenario(ctx).bulkerAsset,
        $asset1: getConfigForScenario(ctx).bulkerAsset1,
      }
    ),
    tokenBalances: async (ctx) => (
      {
        albert: {
          $base: `== ${getConfigForScenario(ctx).bulkerBase}`,
          $asset0: getConfigForScenario(ctx).bulkerAsset,
          $asset1: getConfigForScenario(ctx).bulkerAsset1
        },
        $comet: { $base: getConfigForScenario(ctx).bulkerComet },
      }
    ),
  },
  async ({ comet, actors, rewards, bulker }, context, world) => {
    const { albert, betty } = actors;
    const wrappedNativeToken = await bulker.wrappedNativeToken();
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    // if asset 0 is native token we took asset 1
    const { asset: asset0, scale: scale0 } = await comet.getAssetInfo(0);
    const { asset: asset1, scale: scale1 } = await comet.getAssetInfo(1);
    const { asset: collateralAssetAddress, scale: scaleBN } = asset0 === wrappedNativeToken ? { asset: asset1, scale: scale1 } : { asset: asset0, scale: scale0 };
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const [rewardTokenAddress] = await rewards.rewardConfig(comet.address);
    const toSupplyBase = BigInt(getConfigForScenario(context).bulkerBase) * baseScale;
    const toSupplyCollateral = BigInt(asset0 === wrappedNativeToken ? getConfigForScenario(context).bulkerAsset1 : getConfigForScenario(context).bulkerAsset) * collateralScale;
    const toBorrowBase = BigInt(getConfigForScenario(context).bulkerBorrowBase) * baseScale;
    const toTransferBase = BigInt(getConfigForScenario(context).bulkerBorrowAsset) * baseScale;
    const toSupplyEth = exp(0.01, 18);
    const toWithdrawEth = exp(0.005, 18);

    // Approvals
    await baseAsset.approve(albert, comet.address);
    await collateralAsset.approve(albert, comet.address);
    await albert.allow(bulker.address, true);

    // Accrue some rewards to Albert, then transfer away Albert's supplied base
    await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: toSupplyBase });
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
    // 1. Supplies 3000 units of collateral
    // 2. Borrows 1000 base
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
      claimRewardCalldata
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET(),
      await bulker.ACTION_CLAIM_REWARD(),
    ];

    if (await hasNativeAsCollateralOrBase(context)) {
      calldata.push(supplyEthCalldata);
      calldata.push(withdrawEthCalldata);
      actions.push(await bulker.ACTION_SUPPLY_NATIVE_TOKEN());
      actions.push(await bulker.ACTION_WITHDRAW_NATIVE_TOKEN());
    }

    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    if (await hasNativeAsCollateralOrBase(context)) expect(await comet.collateralBalanceOf(albert.address, wrappedNativeToken)).to.be.equal(toSupplyEth - toWithdrawEth);
    expect(await albert.getErc20Balance(rewardTokenAddress)).to.be.equal(expectedFinalRewardBalance);
    expectBase((await comet.balanceOf(betty.address)).toBigInt(), baseTransferred);
    expectBase((await comet.borrowBalanceOf(albert.address)).toBigInt(), toBorrowBase + toTransferBase);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#bulker > (WETH base) all actions in one txn',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) &&
      await isRewardSupported(ctx) &&
      matchesDeployment(ctx, [{ deployment: 'weth' }, { network: 'ronin', deployment: 'wron'}]) &&
      !matchesDeployment(ctx, [{ network: 'ronin', deployment: 'weth'}]),
    supplyCaps: async (ctx) => (
      {
        $asset0: getConfigForScenario(ctx).bulkerAsset2,
      }
    ),
    tokenBalances: async (ctx) => (
      {
        albert: { $base: `== ${getConfigForScenario(ctx).bulkerBase1}`, $asset0: getConfigForScenario(ctx).bulkerAsset2 },
        $comet: { $base: getConfigForScenario(ctx).bulkerComet },
      }
    ),
  },
  async ({ comet, actors, rewards, bulker }, context, world) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseScale = (await comet.baseScale()).toBigInt();
    const { asset: collateralAssetAddress, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(collateralAssetAddress);
    const collateralScale = scaleBN.toBigInt();
    const [rewardTokenAddress] = await rewards.rewardConfig(comet.address);
    const toSupplyBase = BigInt(getConfigForScenario(context).bulkerBase1) * baseScale;
    const toSupplyCollateral = BigInt(getConfigForScenario(context).bulkerAsset2) * collateralScale;
    const toBorrowBase = 5n * baseScale;
    const toTransferBase = 2n * baseScale;
    const toSupplyEth = exp(0.01, 18);
    const toWithdrawEth = exp(0.005, 18);

    // Approvals
    await baseAsset.approve(albert, comet.address);
    await collateralAsset.approve(albert, comet.address);
    await albert.allow(bulker.address, true);

    // Accrue some rewards to Albert, then transfer away Albert's supplied base
    await albert.safeSupplyAsset({ asset: baseAssetAddress, amount: toSupplyBase });
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
    // 1. Supplies 10 units of collateral
    // 2. Borrows 5 base
    // 3. Transfers 2 base to Betty
    // 4. Supplies 0.01 ETH
    // 5. Withdraws 0.005 ETH
    // 6. Claim rewards
    const supplyAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, albert.address, collateralAsset.address, toSupplyCollateral]);
    const withdrawAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, albert.address, baseAsset.address, toBorrowBase]);
    const transferAssetCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'uint'], [comet.address, betty.address, baseAsset.address, toTransferBase]);
    const supplyNativeTokenCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, albert.address, toSupplyEth]);
    const withdrawNativeTokenCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [comet.address, albert.address, toWithdrawEth]);
    const claimRewardCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'address', 'bool'], [comet.address, rewards.address, albert.address, true]);
    const calldata = [
      supplyAssetCalldata,
      withdrawAssetCalldata,
      transferAssetCalldata,
      supplyNativeTokenCalldata,
      withdrawNativeTokenCalldata,
      claimRewardCalldata
    ];
    const actions = [
      await bulker.ACTION_SUPPLY_ASSET(),
      await bulker.ACTION_WITHDRAW_ASSET(),
      await bulker.ACTION_TRANSFER_ASSET(),
      await bulker.ACTION_SUPPLY_NATIVE_TOKEN(),
      await bulker.ACTION_WITHDRAW_NATIVE_TOKEN(),
      await bulker.ACTION_CLAIM_REWARD(),
    ];
    const txn = await albert.invoke({ actions, calldata }, { value: toSupplyEth });

    // Final expectations
    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseTransferred = getExpectedBaseBalance(toTransferBase, baseIndexScale, baseSupplyIndex);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupplyCollateral);
    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(toBorrowBase);
    expect(await albert.getErc20Balance(rewardTokenAddress)).to.be.equal(expectedFinalRewardBalance);
    expectBase((await comet.balanceOf(betty.address)).toBigInt(), baseTransferred);
    // NOTE: differs from the equivalent scenario for non-ETH markets
    expectBase((await comet.borrowBalanceOf(albert.address)).toBigInt(), toBorrowBase + toTransferBase - (toSupplyEth - toWithdrawEth));

    return txn; // return txn to measure gas
  }
);