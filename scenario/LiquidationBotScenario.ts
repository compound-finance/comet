import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { isValidAssetIndex, MAX_ASSETS, timeUntilUnderwater } from './utils';
import { event, exp, wait } from '../test/helpers';
import { BigNumber, constants } from 'ethers';
import CometActor from './context/CometActor';
import { CometInterface } from '../build/types';

const daiPool = {
  tokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  poolFee: 100
};

const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const RECIPIENT = '0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F';
const UNISWAP_ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564';
const SUSHISWAP_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

enum Exchange {
  Uniswap,
  SushiSwap
}

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
        betty: { $base: 1000 },
      },
    },
    async ({ comet, actors, assets }, _context, world) => {
      const { albert, betty } = actors;
      const { USDC } = assets;

      const liquidator = await world.deploymentManager.deploy(
        'liquidator',
        'liquidator/Liquidator.sol',
        [
          RECIPIENT, // _recipient
          UNISWAP_ROUTER, // _uniswapRouter
          SUSHISWAP_ROUTER, // _sushiSwapRouter
          comet.address, // _comet
          UNISWAP_V3_FACTORY_ADDRESS, // _factory
          WETH9, // _WETH9
          10e6, // _liquidationThreshold,
          [
            '0xc00e94Cb662C3520282E6f5717214004A7f26888', // COMP
            '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
            '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
            '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
            '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
          ],
          [
            true,
            true,
            false,
            true,
            true
          ],
          [
            3000,
            3000,
            500,
            3000,
            3000
          ],
          [
            Exchange.SushiSwap, // COMP
            Exchange.Uniswap,   // WBTC
            Exchange.Uniswap,   // WETH
            Exchange.Uniswap,   // UNI
            Exchange.Uniswap,   // LINK
          ],
          [
            constants.MaxUint256, // COMP
            constants.MaxUint256, // WBTC
            constants.MaxUint256, // WETH
            constants.MaxUint256, // UNI
            constants.MaxUint256, // LINK
          ]
        ]
      );

      const initialRecipientBalance = await USDC.balanceOf(RECIPIENT);

      const baseToken = await comet.baseToken();
      const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
      const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(i);

      const borrowCapacity = await borrowCapacityForAsset(comet, albert, i);
      const borrowAmount = (borrowCapacity.mul(90n)).div(100n);

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

      await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

      expect(await comet.isLiquidatable(albert.address)).to.be.true;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

      await liquidator.connect(betty.signer).initFlash({
        accounts: [albert.address],
        pairToken: daiPool.tokenAddress,
        poolFee: daiPool.poolFee
      });

      // confirm that Albert position has been abosrbed
      expect(await comet.isLiquidatable(albert.address)).to.be.false;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

      // confirm that protocol reserves have increased
      expect(await comet.getReserves()).to.be.above(initialReserves);

      // confirm is not holding a significant amount of the collateral asset
      expect(await comet.getCollateralReserves(collateralAssetAddress)).to.be.below(scale);

      // check that recipient balance increased
      expect(await USDC.balanceOf(RECIPIENT)).to.be.greaterThan(Number(initialRecipientBalance));
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
    `LiquidationBot > liquidates large position of $asset${i}, by setting maxCollateralToPurchase`,
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
      const { USDC } = assets;

      const liquidator = await world.deploymentManager.deploy(
        'liquidator',
        'liquidator/Liquidator.sol',
        [
          RECIPIENT, // _recipient
          UNISWAP_ROUTER, // _uniswapRouter
          SUSHISWAP_ROUTER, // _sushiSwapRouter
          comet.address, // _comet
          UNISWAP_V3_FACTORY_ADDRESS, // _factory
          WETH9, // _WETH9
          10e6, // _liquidationThreshold,
          [
            '0xc00e94Cb662C3520282E6f5717214004A7f26888', // COMP
            '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
            '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
            '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
            '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
          ],
          [
            true,
            true,
            false,
            true,
            true
          ],
          [
            3000,
            3000,
            500,
            3000,
            3000
          ],
          [
            Exchange.SushiSwap, // COMP
            Exchange.Uniswap,   // WBTC
            Exchange.Uniswap,   // WETH
            Exchange.Uniswap,   // UNI
            Exchange.Uniswap,   // LINK
          ],
          [
            BigNumber.from(exp(1000,18)),   // COMP
            BigNumber.from(exp(120,8)),     //  WBTC
            BigNumber.from(exp(5000,18)),   // WETH
            BigNumber.from(exp(150000,18)), // UNI
            BigNumber.from(exp(250000,18)), // LINK
          ]
        ]
      );

      const initialRecipientBalance = await USDC.balanceOf(RECIPIENT);

      const baseToken = await comet.baseToken();
      const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
      const { asset: collateralAssetAddress } = await comet.getAssetInfo(i);

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

      await liquidator.connect(betty.signer).initFlash({
        accounts: [albert.address],
        pairToken: daiPool.tokenAddress,
        poolFee: daiPool.poolFee
      });

      // confirm that Albert position has been abosrbed
      expect(await comet.isLiquidatable(albert.address)).to.be.false;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

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
        $asset0: ' == 5',
      },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors, assets }, _context, world) => {
    const { albert, betty } = actors;
    const { USDC } = assets;

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/Liquidator.sol',
      [
        RECIPIENT, // _recipient
        UNISWAP_ROUTER, // _uniswapRouter
        SUSHISWAP_ROUTER, // _sushiSwapRouter
        comet.address, // _comet
        UNISWAP_V3_FACTORY_ADDRESS, // _factory
        WETH9, // _WETH9
        1000e6, // _liquidationThreshold,
        [
          '0xc00e94Cb662C3520282E6f5717214004A7f26888', // COMP
          '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
          '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
          '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        ],
        [
          true,
          true,
          false,
          true,
          true
        ],
        [
          3000,
          3000,
          500,
          3000,
          3000
        ],
        [
          Exchange.SushiSwap, // COMP
          Exchange.Uniswap,   // WBTC
          Exchange.Uniswap,   // WETH
          Exchange.Uniswap,   // UNI
          Exchange.Uniswap,   // LINK
        ],
        [
          constants.MaxUint256, // COMP
          constants.MaxUint256, // WBTC
          constants.MaxUint256, // WETH
          constants.MaxUint256, // UNI
          constants.MaxUint256, // LINK
        ]
      ]
    );

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
      AbsorbedWithoutBuyingCollateral: {}
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
        $asset0: ' == 5',
      },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors, assets }, _context, world) => {
    const { albert, betty } = actors;
    const { USDC } = assets;

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/Liquidator.sol',
      [
        RECIPIENT, // _recipient
        UNISWAP_ROUTER, // _uniswapRouter
        SUSHISWAP_ROUTER, // _sushiSwapRouter
        comet.address, // _comet
        UNISWAP_V3_FACTORY_ADDRESS, // _factory
        WETH9, // _WETH9
        0, // _liquidationThreshold,
        [
          '0xc00e94Cb662C3520282E6f5717214004A7f26888', // COMP
          '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
          '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
          '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        ],
        [
          true,
          true,
          false,
          true,
          true
        ],
        [
          3000,
          3000,
          500,
          3000,
          3000
        ],
        [
          Exchange.SushiSwap, // COMP
          Exchange.Uniswap,   // WBTC
          Exchange.Uniswap,   // WETH
          Exchange.Uniswap,   // UNI
          Exchange.Uniswap,   // LINK
        ],
        [
          0, // COMP
          0, // WBTC
          0, // WETH
          0, // UNI
          0, // LINK
        ]
      ]
    );

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
      AbsorbedWithoutBuyingCollateral: {}
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
    const { USDC } = assets;

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/Liquidator.sol',
      [
        RECIPIENT, // _recipient
        UNISWAP_ROUTER, // _uniswapRouter
        SUSHISWAP_ROUTER, // _sushiSwapRouter
        comet.address, // _comet
        UNISWAP_V3_FACTORY_ADDRESS, // _factory
        WETH9, // _WETH9
        0, // _liquidationThreshold,
        [
          '0xc00e94Cb662C3520282E6f5717214004A7f26888', // COMP
          '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
          '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
          '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
          '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        ],
        [
          true,
          true,
          false,
          true,
          true
        ],
        [
          3000,
          3000,
          500,
          3000,
          3000
        ],
        [
          Exchange.SushiSwap, // COMP
          Exchange.Uniswap,   // WBTC
          Exchange.Uniswap,   // WETH
          Exchange.Uniswap,   // UNI
          Exchange.Uniswap,   // LINK
        ],
        [
          constants.MaxUint256, // COMP
          constants.MaxUint256, // WBTC
          constants.MaxUint256, // WETH
          constants.MaxUint256, // UNI
          constants.MaxUint256, // LINK
        ]
      ]
    );

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