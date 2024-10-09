import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately, expectBase, expectRevertCustom, expectRevertMatches, getExpectedBaseBalance, getInterest, isTriviallySourceable, isValidAssetIndex, MAX_ASSETS, UINT256_MAX } from './utils';
import { ContractReceipt } from 'ethers';
import { matchesDeployment } from './utils';
import { exp } from '../test/helpers';
import { ethers } from 'hardhat';

// XXX introduce a SupplyCapConstraint to separately test the happy path and revert path instead
// of testing them conditionally
async function testSupplyCollateral(context: CometContext, assetNum: number): Promise<void | ContractReceipt> {
  const comet = await context.getComet();
  const { albert } = await context.actors;
  const { asset: assetAddress, scale: scaleBN, supplyCap } = await comet.getAssetInfo(assetNum);
  const collateralAsset = context.getAssetByAddress(assetAddress);
  const scale = scaleBN.toBigInt();
  const toSupply = 100n * scale;

  expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(toSupply);

  await collateralAsset.approve(albert, comet.address);

  const totalCollateralSupply = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset.toBigInt();
  if (totalCollateralSupply + toSupply > supplyCap.toBigInt()) {
    await expectRevertCustom(
      albert.supplyAsset({
        asset: collateralAsset.address,
        amount: 100n * scale,
      }),
      'SupplyCapExceeded()'
    );
  } else {
    // Albert supplies 100 units of collateral to Comet
    const txn = await albert.supplyAsset({ asset: collateralAsset.address, amount: toSupply });

    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupply);

    return txn; // return txn to measure gas
  }
}

async function testSupplyFromCollateral(context: CometContext, assetNum: number): Promise<void | ContractReceipt> {
  const comet = await context.getComet();
  const { albert, betty } = await context.actors;
  const { asset: assetAddress, scale: scaleBN, supplyCap } = await comet.getAssetInfo(assetNum);
  const collateralAsset = context.getAssetByAddress(assetAddress);
  const scale = scaleBN.toBigInt();
  const toSupply = 100n * scale;

  expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(toSupply);
  expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(0n);

  await collateralAsset.approve(albert, comet.address);
  await albert.allow(betty, true);

  const totalCollateralSupply = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset.toBigInt();
  if (totalCollateralSupply + toSupply > supplyCap.toBigInt()) {
    await expectRevertCustom(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: toSupply,
      }),
      'SupplyCapExceeded()'
    );
  } else {
    // Betty supplies 100 units of collateral from Albert
    const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: collateralAsset.address, amount: toSupply });

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(toSupply);

    return txn; // return txn to measure gas
  }
}

for (let i = 0; i < MAX_ASSETS; i++) {
  const amountToSupply = 100; // in units of asset, not wei
  scenario(
    `Comet#supply > collateral asset ${i}`,
    {
      // XXX Unfortunately, the filtering step happens before solutions are run, so this will filter out
      // hypothetical assets added during the migration/proposal constraint because those assets don't exist
      // yet
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, amountToSupply),
      tokenBalances: {
        albert: { [`$asset${i}`]: amountToSupply },
      },
    },
    async (_properties, context) => {
      return await testSupplyCollateral(context, i);
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  const amountToSupply = 100; // in units of asset, not wei
  scenario(
    `Comet#supplyFrom > collateral asset ${i}`,
    {
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, amountToSupply),
      tokenBalances: {
        albert: { [`$asset${i}`]: amountToSupply },
      },
    },
    async (_properties, context) => {
      return await testSupplyFromCollateral(context, i);
    }
  );
}

scenario(
  'Comet#supply > base asset',
  {
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);

    // Albert supplies 100 units of base to Comet
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 100n * scale });

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(100n * scale, baseIndexScale, baseSupplyIndex);

    expect(await comet.balanceOf(albert.address)).to.be.equal(baseSupplied);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply > base asset with token fees',
  {
    tokenBalances: {
      albert: { $base: 1000 }, // in units of asset, not wei
    },
    filter: async (ctx) => matchesDeployment(ctx, [{ network: 'mainnet', deployment: 'usdt' }])
  },
  async ({ comet, actors }, context, world) => {
    // Set fees for USDT for testing
    const USDT = await world.deploymentManager.existing('USDT', await comet.baseToken(), world.base.network);
    const USDTAdminAddress = await USDT.owner();
    await world.deploymentManager.hre.network.provider.send('hardhat_setBalance', [
      USDTAdminAddress,
      ethers.utils.hexStripZeros(ethers.utils.parseEther('100').toHexString()),
    ]);
    await world.deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDTAdminAddress],
    });
    // mine a block to ensure the impersonation is effective
    const USDTAdminSigner = await world.deploymentManager.hre.ethers.getSigner(USDTAdminAddress);
    // 10 basis points, and max 10 USDT
    await USDT.connect(USDTAdminSigner).setParams(10, 10);

    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(1000n * scale);

    // Albert supplies 1000 units of base to Comet
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 1000n * scale });

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(999n * scale, baseIndexScale, baseSupplyIndex);

    expect(await comet.balanceOf(albert.address)).to.be.equal(baseSupplied);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply > repay borrow',
  {
    tokenBalances: {
      albert: { $base: '==1000' }
    },
    cometBalances: {
      albert: { $base: -1000 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    expectApproximately(await albert.getCometBaseBalance(), -1000n * scale, getInterest(1000n * scale, borrowRate, 1n) + 1n);

    // Albert repays 100 units of base borrow
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 1000n * scale });

    // XXX all these timings are crazy
    expectApproximately(await albert.getCometBaseBalance(), 0n, getInterest(1000n * scale, borrowRate, 4n) + 2n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply > repay borrow with token fees',
  {
    tokenBalances: {
      albert: { $base: '==1000' }
    },
    cometBalances: {
      albert: { $base: -1000 } // in units of asset, not wei
    },
    filter: async (ctx) => matchesDeployment(ctx, [{ network: 'mainnet', deployment: 'usdt' }]),
  },
  async ({ comet, actors }, context, world) => {
    // Set fees for USDT for testing
    const USDT = await world.deploymentManager.existing('USDT', await comet.baseToken(), world.base.network);
    const USDTAdminAddress = await USDT.owner();
    await world.deploymentManager.hre.network.provider.send('hardhat_setBalance', [
      USDTAdminAddress,
      ethers.utils.hexStripZeros(ethers.utils.parseEther('100').toHexString()),
    ]);
    await world.deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDTAdminAddress],
    });
    // mine a block to ensure the impersonation is effective
    const USDTAdminSigner = await world.deploymentManager.hre.ethers.getSigner(USDTAdminAddress);
    // 10 basis points, and max 10 USDT
    await USDT.connect(USDTAdminSigner).setParams(10, 10);

    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    expectApproximately(await albert.getCometBaseBalance(), -1000n * scale, getInterest(1000n * scale, borrowRate, 1n) + 1n);

    // Albert repays 1000 units of base borrow
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 1000n * scale });

    // XXX all these timings are crazy
    // Expect to have -1000000, due to token fee, alber only repay 999 USDT instead of 1000 USDT, thus alber still owe 1 USDT which is 1000000
    expectApproximately(await albert.getCometBaseBalance(), -1n * exp(1, 6), getInterest(1000n * scale, borrowRate, 4n) + 2n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply > repay all borrow with token fees',
  {
    tokenBalances: {
      albert: { $base: '==1000' }
    },
    cometBalances: {
      albert: { $base: -999 } // in units of asset, not wei
    },
    filter: async (ctx) => matchesDeployment(ctx, [{ network: 'mainnet', deployment: 'usdt' }]),
  },
  async ({ comet, actors }, context, world) => {
    // Set fees for USDT for testing
    const USDT = await world.deploymentManager.existing('USDT', await comet.baseToken(), world.base.network);
    const USDTAdminAddress = await USDT.owner();
    await world.deploymentManager.hre.network.provider.send('hardhat_setBalance', [
      USDTAdminAddress,
      ethers.utils.hexStripZeros(ethers.utils.parseEther('100').toHexString()),
    ]);
    await world.deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDTAdminAddress],
    });
    // mine a block to ensure the impersonation is effective
    const USDTAdminSigner = await world.deploymentManager.hre.ethers.getSigner(USDTAdminAddress);
    // 10 basis points, and max 10 USDT
    await USDT.connect(USDTAdminSigner).setParams(10, 10);

    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    expectApproximately(await albert.getCometBaseBalance(), -999n * scale, getInterest(999n * scale, borrowRate, 1n) + 2n);

    // Albert repays 1000 units of base borrow
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 1000n * scale });

    // XXX all these timings are crazy
    // albert supply 1000 USDT to repay, 1000USDT * (99.9%) = 999 USDT, thus albert should have just enough to repay his debt of 999 USDT.
    expectApproximately(await albert.getCometBaseBalance(), 0n, getInterest(1000n * scale, borrowRate, 4n) + 2n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supplyFrom > base asset',
  {
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);
    expect(await comet.balanceOf(betty.address)).to.be.equal(0n);

    await baseAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    // Betty supplies 100 units of base from Albert
    const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: 100n * scale });

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(100n * scale, baseIndexScale, baseSupplyIndex);

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(betty.address)).to.be.equal(baseSupplied);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supplyFrom > base asset with token fees',
  {
    tokenBalances: {
      albert: { $base: 1000 }, // in units of asset, not wei
    },
    filter: async (ctx) => matchesDeployment(ctx, [{ network: 'mainnet', deployment: 'usdt' }]),
  },
  async ({ comet, actors }, context, world) => {
    // Set fees for USDT for testing
    const USDT = await world.deploymentManager.existing('USDT', await comet.baseToken(), world.base.network);
    const USDTAdminAddress = await USDT.owner();
    await world.deploymentManager.hre.network.provider.send('hardhat_setBalance', [
      USDTAdminAddress,
      ethers.utils.hexStripZeros(ethers.utils.parseEther('100').toHexString()),
    ]);
    await world.deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDTAdminAddress],
    });
    // mine a block to ensure the impersonation is effective
    const USDTAdminSigner = await world.deploymentManager.hre.ethers.getSigner(USDTAdminAddress);
    // 10 basis points, and max 10 USDT
    await USDT.connect(USDTAdminSigner).setParams(10, 10);

    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(1000n * scale);
    expect(await comet.balanceOf(betty.address)).to.be.equal(0n);

    await baseAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    // Betty supplies 1000 units of base from Albert
    const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: 1000n * scale });

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(999n * scale, baseIndexScale, baseSupplyIndex);

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(betty.address)).to.be.equal(baseSupplied);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supplyFrom > repay borrow',
  {
    tokenBalances: {
      albert: { $base: 1010 }
    },
    cometBalances: {
      betty: { $base: '<= -1000' } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await baseAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    // Betty supplies max base from Albert to repay all borrows
    const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: UINT256_MAX });

    expect(await baseAsset.balanceOf(albert.address)).to.be.lessThan(10n * scale);
    expectBase(await betty.getCometBaseBalance(), 0n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply reverts if not enough ERC20 approval',
  {
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await expect(
      albert.supplyAsset({
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.reverted;
    // ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
  }
);

scenario(
  'Comet#supplyFrom reverts if not enough ERC20 base approval',
  {
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await albert.allow(betty, true);
    await baseAsset.approve(albert, betty, 10n * scale);

    await expect(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.reverted;
    // ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
  }
);

scenario(
  'Comet#supplyFrom reverts if not enough ERC20 collateral approval',
  {
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const symbol = await collateralAsset.token.symbol();
    const scale = scaleBN.toBigInt();

    await albert.allow(betty, true);
    await collateralAsset.approve(albert, betty, 10n * scale);

    await expectRevertMatches(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: 100n * scale,
      }),
      [
        /ERC20: transfer amount exceeds allowance/,
        /ERC20: insufficient allowance/,
        /transfer amount exceeds spender allowance/,
        /Dai\/insufficient-allowance/,
        symbol === 'WETH' ? /Transaction reverted without a reason string/ : /.^/,
        symbol === 'wstETH' ? /0xc2139725/ : /.^/,
        symbol === 'WMATIC' ? /Transaction reverted without a reason string/ : /.^/,
      ]
    );
  }
);

scenario(
  'Comet#supply reverts if not enough ERC20 balance',
  {
    tokenBalances: {
      albert: { $base: 10 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await baseAsset.approve(albert, comet.address);
    await expect(
      albert.supplyAsset({
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.reverted;
    // ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
  }
);

scenario(
  'Comet#supplyFrom reverts if not enough ERC20 base balance',
  {
    tokenBalances: {
      albert: { $base: 10 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await baseAsset.approve(albert, comet.address);
    await albert.allow(betty, true);
    await expect(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.reverted;
    // ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
  }
);

scenario(
  'Comet#supplyFrom reverts if not enough ERC20 collateral balance',
  {
    tokenBalances: {
      albert: { $asset0: 10 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const symbol = await collateralAsset.token.symbol();
    const scale = scaleBN.toBigInt();

    await collateralAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    await expectRevertMatches(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: 100n * scale,
      }),
      [
        /transfer amount exceeds balance/,
        /Dai\/insufficient-balance/,
        symbol === 'WETH' ? /Transaction reverted without a reason string/ : /.^/,
        symbol === 'wstETH' ? /0x00b284f2/ : /.^/,
        symbol === 'WMATIC' ? /Transaction reverted without a reason string/ : /.^/,
      ]
    );
  }
);

scenario(
  'Comet#supplyFrom reverts if operator not given permission',
  {
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await baseAsset.approve(albert, comet.address);
    await expectRevertCustom(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 100n * scale,
      }),
      'Unauthorized()'
    );
  }
);

scenario(
  'Comet#supply reverts when supply is paused',
  {
    pause: {
      supplyPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert } = actors;

    const baseToken = await comet.baseToken();

    await expectRevertCustom(
      albert.supplyAsset({
        asset: baseToken,
        amount: 100,
      }),
      'Paused()'
    );
  }
);

scenario(
  'Comet#supplyFrom reverts when supply is paused',
  {
    pause: {
      supplyPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expectRevertCustom(
      albert.supplyAssetFrom({
        src: betty.address,
        dst: albert.address,
        asset: baseToken,
        amount: 100,
      }),
      'Paused()'
    );
  }
);

scenario(
  'Comet#supply reverts if asset is not supported',
  {},
  async () => {
    // XXX requires deploying an unsupported asset (maybe via remote token constraint)
  }
);

// XXX enforce supply cap