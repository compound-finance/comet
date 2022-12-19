import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { isValidAssetIndex, MAX_ASSETS, timeUntilUnderwater } from './utils';
import { ethers, event, wait } from '../test/helpers';
import CometActor from './context/CometActor';
import { CometInterface, OnChainLiquidator } from '../build/types';
import { getPoolConfig, flashLoanPools } from '../scripts/liquidation_bot/liquidateUnderwaterBorrowers';

const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const RECIPIENT = '0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F';

async function borrowCapacityForAsset(comet: CometInterface, actor: CometActor, assetIndex: number) {
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

for (let i = 0; i < MAX_ASSETS; i++) {
  // XXX make this a map from asset addresses to asset amounts
  const assetAmounts = [
    // COMP
    ' == 500',
    // WBTC
    ' == 120',
    // WETH
    ' == 5000',
    // UNI
    ' == 150000',
    // LINK
    ' == 250000',
  ];
  scenario(
    `LiquidationBot > liquidates an underwater position of $asset${i} ${assetAmounts[i] || ''} with no maxCollateralPurchase`,
    {
      filter: async (ctx) => ctx.world.base.network === 'mainnet' && await isValidAssetIndex(ctx, i),
      tokenBalances: {
        $comet: { $base: 1000 },
      },
      cometBalances: {
        albert: {
          [`$asset${i}`]: assetAmounts[i] || 0
        },
      },
    },
    async ({ comet, actors }, _context, world) => {
      const { albert, betty } = actors;
      const { network, deployment } = world.deploymentManager;
      const flashLoanPool = flashLoanPools[network][deployment];

      const liquidator = await world.deploymentManager.deploy(
        'liquidator',
        'liquidator/OnChainLiquidator.sol',
        [UNISWAP_V3_FACTORY_ADDRESS, WETH9]
      ) as OnChainLiquidator;

      const baseToken = await comet.baseToken();
      const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
      const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(i);

      const borrowCapacity = await borrowCapacityForAsset(comet, albert, i);
      const borrowAmount = (borrowCapacity.mul(90n)).div(100n);

      const initialRecipientBalance = await betty.getErc20Balance(baseToken);

      // Do a manual withdrawAsset (instead of setting $base to a negative
      // number) so we can confirm that albert only has one type of collateral asset
      await albert.withdrawAsset({
        asset: baseToken,
        amount: borrowAmount
      });

      await world.increaseTime(
        await timeUntilUnderwater({
          comet,
          actor: albert,
          fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
        })
      );

      // define after increasing time, since increasing time alters reserves
      const initialReserves = (await comet.getReserves()).toBigInt();

      await comet.connect(betty.signer).accrueAccount(albert.address); // force accrue

      expect(await comet.isLiquidatable(albert.address)).to.be.true;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

      await liquidator.connect(betty.signer).absorbAndArbitrage(
        comet.address,
        [albert.address],
        [collateralAssetAddress],
        [getPoolConfig(collateralAssetAddress)],
        [ethers.constants.MaxUint256],
        flashLoanPool.tokenAddress,
        flashLoanPool.poolFee,
        10e6
      );

      // confirm that Albert position has been abosrbed
      expect(await comet.isLiquidatable(albert.address)).to.be.false;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

      // confirm that protocol reserves have increased
      expect(await comet.getReserves()).to.be.above(initialReserves);

      // confirm is not holding a significant amount of the collateral asset
      expect(await comet.getCollateralReserves(collateralAssetAddress)).to.be.below(scale);

      // check that recipient balance increased
      expect(await betty.getErc20Balance(baseToken)).to.be.greaterThan(Number(initialRecipientBalance));
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  const assetAmounts = [
    // COMP
    ' == 40000',
    // WBTC
    ' == 1200',
    // WETH
    ' == 10000',
    // UNI
    ' == 250000',
    // LINK
    ' == 500000',
  ];

  scenario(
    `LiquidationBot > partially liquidates large position of $asset${i}, by setting maxCollateralToPurchase`,
    {
      filter: async (ctx) => ctx.world.base.network === 'mainnet' && await isValidAssetIndex(ctx, i),
      tokenBalances: {
        $comet: { $base: 1000 },
      },
      cometBalances: {
        albert: {
          [`$asset${i}`]: assetAmounts[i] || 0
        },
        betty: { $base: 1000 },
      },
    },
    async ({ comet, actors, assets }, _context, world) => {
      const { albert, betty } = actors;
      const { USDC, COMP, WBTC, WETH, UNI, LINK } = assets;

      const liquidator = await world.deploymentManager.deploy(
        'liquidator',
        'liquidator/OnChainLiquidator.sol',
        [UNISWAP_V3_FACTORY_ADDRESS, WETH9]
      ) as OnChainLiquidator;

      const initialRecipientBalance = await USDC.balanceOf(RECIPIENT);

      const baseToken = await comet.baseToken();
      const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
      const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(i);

      const borrowCapacity = await borrowCapacityForAsset(comet, albert, i);
      const borrowAmount = (borrowCapacity.mul(90n)).div(100n);

      await albert.withdrawAsset({
        asset: baseToken,
        amount: borrowAmount
      });

      await world.increaseTime(
        await timeUntilUnderwater({
          comet,
          actor: albert,
          fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
        })
      );

      await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

      expect(await comet.isLiquidatable(albert.address)).to.be.true;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

      await liquidator.connect(betty.signer).absorbAndArbitrage(
        comet.address,
        [albert.address],
        [collateralAssetAddress],
        [getPoolConfig(collateralAssetAddress)],
        [ethers.constants.MaxUint256],
        daiPool.tokenAddress,
        daiPool.poolFee,
        10e6
      );

      // confirm that Albert position has been abosrbed
      expect(await comet.isLiquidatable(albert.address)).to.be.false;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

      // confirm that protocol was only partially liquidated; it should still
      // hold a significant amount of the asset
      expect(await comet.getCollateralReserves(collateralAssetAddress)).to.be.above(scale.mul(10));

      // check that recipient balance increased
      expect(await USDC.balanceOf(RECIPIENT)).to.be.greaterThan(Number(initialRecipientBalance));
    }
  );
}

scenario(
  `LiquidationBot > absorbs, but does not attempt to purchase collateral when value is beneath liquidationThreshold`,
  {
    filter: async (ctx) => ctx.world.base.network === 'mainnet',
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: {
        $asset0: ' == 10',
      },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors, assets }, _context, world) => {
    const { albert, betty } = actors;
    const { USDC, COMP, WBTC, WETH, UNI, LINK } = assets;

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/OnChainLiquidator.sol',
      [UNISWAP_V3_FACTORY_ADDRESS, WETH9]
    ) as OnChainLiquidator;

    const initialRecipientBalance = await USDC.balanceOf(RECIPIENT);

    const baseToken = await comet.baseToken();
    const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
    const { asset: collateralAssetAddress } = await comet.getAssetInfo(0);

    const borrowCapacity = await borrowCapacityForAsset(comet, albert, 0);
    const borrowAmount = (borrowCapacity.mul(90n)).div(100n);

    await albert.withdrawAsset({
      asset: baseToken,
      amount: borrowAmount
    });

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    const initialReserves = (await comet.getReserves()).toBigInt();

    await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

    const tx = await wait(liquidator.connect(betty.signer).initFlash({
      accounts: [albert.address],
      pairToken: daiPool.tokenAddress,
      poolFee: daiPool.poolFee
    }));

    expect(event(tx, 3)).to.deep.equal({
      Absorb: {
        initiator: betty.address,
        accounts: [ albert.address ]
      }
    });

    // confirm that Albert position has been abosrbed
    expect(await comet.isLiquidatable(albert.address)).to.be.false;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

    // confirm that collateral was not purchased
    expect(event(tx, 4)).to.deep.equal({
      AbsorbWithoutBuyingCollateral: {}
    });

    // XXX confirm that liquidator points increased by 1

    // confirm that protocol reserves have decreased
    expect(await comet.getReserves()).to.be.below(initialReserves);

    // check that recipient balance has stayed the same
    expect(await USDC.balanceOf(RECIPIENT)).to.be.eq(Number(initialRecipientBalance));
  }
);

scenario(
  `LiquidationBot > absorbs, but does not attempt to purchase collateral when maxCollateralToPurchase=0`,
  {
    filter: async (ctx) => ctx.world.base.network === 'mainnet',
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: {
        $asset0: ' == 10',
      },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors, assets }, _context, world) => {
    const { albert, betty } = actors;
    const { USDC, COMP, WBTC, WETH, UNI, LINK } = assets;

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/OnChainLiquidator.sol',
      [UNISWAP_V3_FACTORY_ADDRESS, WETH9]
    ) as OnChainLiquidator;

    const initialRecipientBalance = await USDC.balanceOf(RECIPIENT);

    const baseToken = await comet.baseToken();
    const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
    const { asset: collateralAssetAddress } = await comet.getAssetInfo(0);

    const borrowCapacity = await borrowCapacityForAsset(comet, albert, 0);
    const borrowAmount = (borrowCapacity.mul(90n)).div(100n);

    await albert.withdrawAsset({
      asset: baseToken,
      amount: borrowAmount
    });

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    const initialReserves = (await comet.getReserves()).toBigInt();

    await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

    const tx = await wait(liquidator.connect(betty.signer).initFlash({
      accounts: [albert.address],
      pairToken: daiPool.tokenAddress,
      poolFee: daiPool.poolFee
    }));

    expect(event(tx, 3)).to.deep.equal({
      Absorb: {
        initiator: betty.address,
        accounts: [ albert.address ]
      }
    });

    // confirm that Albert position has been abosrbed
    expect(await comet.isLiquidatable(albert.address)).to.be.false;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

    // confirm that collateral was not purchased
    expect(event(tx, 4)).to.deep.equal({
      AbsorbWithoutBuyingCollateral: {}
    });

    // XXX confirm that liquidator points increased by 1

    // confirm that protocol reserves have decreased
    expect(await comet.getReserves()).to.be.below(initialReserves);

    // check that recipient balance has stayed the same
    expect(await USDC.balanceOf(RECIPIENT)).to.be.eq(Number(initialRecipientBalance));
  }
);

scenario(
  `LiquidationBot > reverts when price slippage is too high`,
  {
    filter: async (ctx) => ctx.world.base.network === 'mainnet',
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: {
        $asset0: ' == 10000',
      },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors, assets }, _context, world) => {
    const { albert, betty } = actors;
    const { USDC, COMP, WBTC, WETH, UNI, LINK } = assets;

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/OnChainLiquidator.sol',
      [UNISWAP_V3_FACTORY_ADDRESS, WETH9]
    ) as OnChainLiquidator;

    const initialRecipientBalance = await USDC.balanceOf(RECIPIENT);

    const baseToken = await comet.baseToken();
    const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
    const { asset: collateralAssetAddress } = await comet.getAssetInfo(0);

    const borrowCapacity = await borrowCapacityForAsset(comet, albert, 0);
    const borrowAmount = (borrowCapacity.mul(90n)).div(100n);

    await albert.withdrawAsset({
      asset: baseToken,
      amount: borrowAmount
    });

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

    await expect(
      liquidator.connect(betty.signer).initFlash({
        accounts: [albert.address],
        pairToken: daiPool.tokenAddress,
        poolFee: daiPool.poolFee
      })
    ).to.be.revertedWithCustomError(liquidator, 'InsufficientAmountOut');

    // confirm that Albert position has not been abosrbed
    expect(await comet.isLiquidatable(albert.address)).to.be.true;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

    // check that recipient balance has stayed the same
    expect(await USDC.balanceOf(RECIPIENT)).to.be.eq(Number(initialRecipientBalance));
  }
);

// XXX test that Liquidator liquidates up to the max amount for that asset
// XXX test that Liquidaator buys selectively (e.g. buys WBTC, but don't buy WETH) based on maxCollateralToPurchase