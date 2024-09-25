import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { isValidAssetIndex, matchesDeployment, MAX_ASSETS, timeUntilUnderwater } from './utils';
import { ethers, event, exp, wait } from '../test/helpers';
import CometActor from './context/CometActor';
import { CometInterface, OnChainLiquidator } from '../build/types';
import { getPoolConfig, flashLoanPools } from '../scripts/liquidation_bot/liquidateUnderwaterBorrowers';

interface LiquidationAddresses {
  balancerVault: string;
  uniswapRouter: string;
  uniswapV3Factory: string;
  sushiswapRouter: string;
  stakedNativeToken: string;
  weth9: string;
  wrappedStakedNativeToken: string;
}

const sharedAddresses = {
  balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  uniswapRouter: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984'
};

const addresses: { [chain: string]: LiquidationAddresses } = {
  mainnet: {
    ...sharedAddresses,
    sushiswapRouter: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    stakedNativeToken: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    weth9: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    wrappedStakedNativeToken: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
  },
  polygon: {
    ...sharedAddresses,
    sushiswapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    stakedNativeToken: '0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4', // stMatic
    weth9: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
    wrappedStakedNativeToken: ethers.constants.AddressZero // wstMatic does not exist
  },
  arbitrum: {
    ...sharedAddresses,
    sushiswapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    stakedNativeToken: ethers.constants.AddressZero,
    weth9: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    wrappedStakedNativeToken: ethers.constants.AddressZero
  }
};

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

// Filters out assets on networks that cannot be liquidated by the open-source liquidation bot
async function canBeLiquidatedByBot(ctx: CometContext, assetNum: number): Promise<boolean> {
  const unsupportedAssets = {
    // Reason: Most liquidity lives in MATICX / MATIC pools, which the liquidation bot cannot use if the base asset is not MATIC
    MaticX: {
      network: 'polygon',
      deployments: ['usdc', 'usdt']
    },

  };
  const comet = await ctx.getComet();
  const assetInfo = await comet.getAssetInfo(assetNum);
  const asset = await ctx.getAssetByAddress(assetInfo.asset);
  const symbol = await asset.token.symbol();
  if (symbol in unsupportedAssets) {
    if (unsupportedAssets[symbol].network === ctx.world.base.network
      && unsupportedAssets[symbol].deployments.includes(ctx.world.base.deployment)) return false;
  }
  return true;
}

for (let i = 0; i < MAX_ASSETS; i++) {
  const baseTokenBalances = {
    mainnet: {
      usdc: 2250000,
      weth: 20
    },
    polygon: {
      usdc: 2250000
    },
    arbitrum: {
      'usdc.e': 10000000,
      usdc: 10000000,
      usdt: 10000000
    }
  };
  const assetAmounts = {
    mainnet: {
      usdc: [
        // COMP
        ' == 500',
        // WBTC
        ' == 120',
        // WETH9
        ' == 5000',
        // UNI:
        ' == 150000',
        // LINK
        ' == 150000'
      ],
      weth: [
        // CB_ETH
        ' == 750',
        // WST_ETH
        ' == 2000'
      ]
    },
    polygon: {
      usdc: [
        // WETH
        ' == 400',
        // WBTC
        ' == 20',
        // WMATIC
        ' == 300000',
        // MATICX
        ' == 0',
      ],
    },
    arbitrum: {
      'usdc.e': [
        // ARB
        ' == 500000',
        // GMX
        ' == 4000',
        // WETH
        ' == 500',
        // WBTC
        ' == 50'
      ],
      usdc: [
        // ARB
        ' == 500000',
        // GMX
        ' == 4000',
        // WETH
        ' == 500',
        // WBTC
        ' == 50'
      ]
    }
  };
  // Skipping these scenarios as they are noisy and should really be moved into a separate monitoring solution
  scenario.skip(
    `LiquidationBot > liquidates an underwater position of $asset${i} with no maxAmountToPurchase`,
    {
      upgrade: {
        targetReserves: exp(20_000, 18)
      },
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && matchesDeployment(ctx, [{ network: 'mainnet' }, { network: 'polygon' }, { network: 'arbitrum' }]) && canBeLiquidatedByBot(ctx, i),
      tokenBalances: async (ctx) => (
        {
          $comet: {
            $base: baseTokenBalances[ctx.world.base.network]?.[ctx.world.base.deployment] || 0,
          },
        }
      ),
      cometBalances: async (ctx) => (
        {
          albert: {
            [`$asset${i}`]: assetAmounts[ctx.world.base.network]?.[ctx.world.base.deployment]?.[i] || 0
          },
        }
      ),
    },
    async ({ comet, actors }, _context, world) => {
      const { albert, betty } = actors;
      const { network, deployment } = world.deploymentManager;
      const flashLoanPool = flashLoanPools[network][deployment];
      const {
        balancerVault,
        uniswapRouter,
        uniswapV3Factory,
        sushiswapRouter,
        stakedNativeToken,
        weth9,
        wrappedStakedNativeToken
      } = addresses[network];

      const liquidator = await world.deploymentManager.deploy(
        'liquidator',
        'liquidator/OnChainLiquidator.sol',
        [
          balancerVault,
          sushiswapRouter,
          uniswapRouter,
          uniswapV3Factory,
          stakedNativeToken,
          wrappedStakedNativeToken,
          weth9
        ]
      ) as OnChainLiquidator;

      const baseToken = await comet.baseToken();
      const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(i);

      const borrowCapacity = await borrowCapacityForAsset(comet, albert, i);
      const borrowAmount = (borrowCapacity.mul(90n)).div(100n);

      const initialRecipientBalance = await betty.getErc20Balance(baseToken);
      const [initialNumAbsorbs, initialNumAbsorbed] = await comet.liquidatorPoints(betty.address);

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

      // confirm that liquidator points increased by 1
      const [finalNumAbsorbs, finalNumAbsorbed] = await comet.liquidatorPoints(betty.address);
      expect(finalNumAbsorbs).to.be.greaterThan(initialNumAbsorbs);
      expect(finalNumAbsorbed).to.be.greaterThan(initialNumAbsorbed);

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
  const baseTokenBalances = {
    mainnet: {
      usdc: 2250000,
      weth: 5000
    },
    polygon: {
      usdc: 3000000
    },
    arbitrum: {
      'usdc.e': 10000000,
      usdc: 10000000,
      usdt: 10000000
    }
  };
  const assetAmounts = {
    mainnet: {
      usdc: [
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
      ],
      weth: [
        // CB_ETH
        ' == 2000',
        // WST_ETH
        ' == 3000'
      ]
    },
    polygon: {
      usdc: [
        // WETH
        ' == 1000',
        // WBTC
        ' == 100',
        // WMATIC
        ' == 2500000',
        // MATICX
        ' == 0',
      ]
    },
    arbitrum: {
      'usdc.e': [
        // ARB
        ' == 1000000',
        // GMX
        ' == 10000',
        // WETH
        ' == 5000',
        // WBTC
        ' == 300'
      ],
      usdc: [
        // ARB
        ' == 1000000',
        // GMX
        ' == 10000',
        // WETH
        ' == 5000',
        // WBTC
        ' == 300'
      ],
      usdt: [
        // ARB
        ' == 1000000',
        // WETH
        ' == 5000',
        // wstETH
        ' == 5000',
        // WBTC
        ' == 300',
        // GMX
        ' == 10000'
      ]
    }
  };
  const maxAmountsToPurchase = {
    mainnet: {
      usdc: [
        // COMP
        exp(500, 18),
        // WBTC
        exp(120, 8),
        // WETH9
        exp(5000, 18),
        // UNI:
        exp(150000, 18),
        // LINK
        exp(150000, 18)
      ],
      weth: [
        // CB_ETH
        exp(750, 18),
        // WST_ETH
        exp(2000, 18)
      ]
    },
    polygon: {
      usdc: [
        // WETH
        exp(400, 18),
        // WBTC
        exp(20, 8),
        // WMATIC
        exp(5000, 18),
        // MATICX
        exp(5, 18)
      ]
    },
    arbitrum: {
      'usdc.e': [
        // ARB
        exp(300000, 18),
        // GMX
        exp(3000, 18),
        // WETH
        exp(500, 18),
        // WBTC
        exp(50, 8),
      ],
      usdc: [
        // ARB
        exp(300000, 18),
        // GMX
        exp(3000, 18),
        // WETH
        exp(500, 18),
        // WBTC
        exp(50, 8),
      ],
      usdt: [
        // ARB
        exp(300000, 18),
        // WETH
        exp(500, 18),
        // wstETH
        exp(500, 18),
        // WBTC
        exp(50, 8),
        // GMX
        exp(3000, 18)
      ]
    }
  };
  // Skipping these scenarios as they are noisy and should really be moved into a separate monitoring solution
  scenario.skip(
    `LiquidationBot > partially liquidates large position of $asset${i}, by setting maxAmountToPurchase`,
    {
      upgrade: {
        targetReserves: exp(20_000, 18)
      },
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && matchesDeployment(ctx, [{ network: 'mainnet' }, { network: 'polygon' }, { network: 'arbitrum' }]) && canBeLiquidatedByBot(ctx, i),
      tokenBalances: async (ctx) => (
        {
          $comet: {
            $base: baseTokenBalances[ctx.world.base.network]?.[ctx.world.base.deployment] || 0,
          },
        }
      ),
      cometBalances: async (ctx) => (
        {
          albert: {
            [`$asset${i}`]: assetAmounts[ctx.world.base.network]?.[ctx.world.base.deployment]?.[i] || 0
          },
        }
      ),
    },
    async ({ comet, actors }, _context, world) => {
      const { albert, betty } = actors;
      const { network, deployment } = world.deploymentManager;
      const flashLoanPool = flashLoanPools[network][deployment];
      const {
        balancerVault,
        uniswapRouter,
        uniswapV3Factory,
        sushiswapRouter,
        stakedNativeToken,
        weth9,
        wrappedStakedNativeToken
      } = addresses[network];

      const liquidator = await world.deploymentManager.deploy(
        'liquidator',
        'liquidator/OnChainLiquidator.sol',
        [
          balancerVault,
          sushiswapRouter,
          uniswapRouter,
          uniswapV3Factory,
          stakedNativeToken,
          wrappedStakedNativeToken,
          weth9
        ]
      ) as OnChainLiquidator;

      const baseToken = await comet.baseToken();
      const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(i);

      const initialRecipientBalance = await betty.getErc20Balance(baseToken);
      const [initialNumAbsorbs, initialNumAbsorbed] = await comet.liquidatorPoints(betty.address);

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

      await comet.connect(betty.signer).accrueAccount(albert.address); // force accrue

      expect(await comet.isLiquidatable(albert.address)).to.be.true;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

      await liquidator.connect(betty.signer).absorbAndArbitrage(
        comet.address,
        [albert.address],
        [collateralAssetAddress],
        [getPoolConfig(collateralAssetAddress)],
        [maxAmountsToPurchase[network][deployment][i]],
        flashLoanPool.tokenAddress,
        flashLoanPool.poolFee,
        10e6
      );

      // confirm that Albert position has been abosrbed
      expect(await comet.isLiquidatable(albert.address)).to.be.false;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

      // confirm that liquidator points increased by 1
      const [finalNumAbsorbs, finalNumAbsorbed] = await comet.liquidatorPoints(betty.address);
      expect(finalNumAbsorbs).to.be.greaterThan(initialNumAbsorbs);
      expect(finalNumAbsorbed).to.be.greaterThan(initialNumAbsorbed);

      // confirm that protocol was only partially liquidated; it should still
      // hold a significant amount of the asset
      expect(await comet.getCollateralReserves(collateralAssetAddress)).to.be.above(scale.mul(10));

      // check that recipient balance increased
      expect(await betty.getErc20Balance(baseToken)).to.be.greaterThan(Number(initialRecipientBalance));
    }
  );
}

scenario(
  `LiquidationBot > absorbs, but does not attempt to purchase collateral when value is beneath liquidationThreshold`,
  {
    filter: async (ctx) => matchesDeployment(ctx, [{ network: 'mainnet' }, { network: 'polygon' }, { network: 'arbitrum' }]) && !matchesDeployment(ctx, [{deployment: 'wsteth', network: 'mainnet'}]),
    tokenBalances: {
      $comet: { $base: 100000 },
    },
    cometBalances: {
      albert: {
        $asset0: ' == 200',
      },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors }, _context, world) => {
    const { albert, betty } = actors;
    const { network, deployment } = world.deploymentManager;
    const flashLoanPool = flashLoanPools[network][deployment];
    const {
      balancerVault,
      uniswapRouter,
      uniswapV3Factory,
      sushiswapRouter,
      stakedNativeToken,
      weth9,
      wrappedStakedNativeToken
    } = addresses[network];

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/OnChainLiquidator.sol',
      [
        balancerVault,
        sushiswapRouter,
        uniswapRouter,
        uniswapV3Factory,
        stakedNativeToken,
        wrappedStakedNativeToken,
        weth9
      ]
    ) as OnChainLiquidator;

    const baseToken = await comet.baseToken();
    const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(0);

    const initialRecipientBalance = await betty.getErc20Balance(baseToken);
    const [initialNumAbsorbs, initialNumAbsorbed] = await comet.liquidatorPoints(betty.address);

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

    await comet.connect(betty.signer).accrueAccount(albert.address); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

    const tx = await wait(liquidator.connect(betty.signer).absorbAndArbitrage(
      comet.address,
      [albert.address],
      [collateralAssetAddress],
      [getPoolConfig(collateralAssetAddress)],
      [ethers.constants.MaxUint256],
      flashLoanPool.tokenAddress,
      flashLoanPool.poolFee,
      scale.mul(1_000_000) // liquidation threshold of 1M units of base asset
    ));

    expect(event(tx, 3)).to.deep.equal({
      Absorb: {
        initiator: betty.address,
        accounts: [albert.address]
      }
    });

    // confirm that Albert position has been abosrbed
    expect(await comet.isLiquidatable(albert.address)).to.be.false;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

    // confirm that collateral was not purchased
    expect(event(tx, 4)).to.deep.equal({
      AbsorbWithoutBuyingCollateral: {}
    });

    // confirm that liquidator points increased by 1
    const [finalNumAbsorbs, finalNumAbsorbed] = await comet.liquidatorPoints(betty.address);
    expect(finalNumAbsorbs).to.be.greaterThan(initialNumAbsorbs);
    expect(finalNumAbsorbed).to.be.greaterThan(initialNumAbsorbed);

    // confirm that protocol reserves have decreased
    expect(await comet.getReserves()).to.be.below(initialReserves);

    // check that recipient balance has stayed the same
    expect(await betty.getErc20Balance(baseToken)).to.be.eq(Number(initialRecipientBalance));
  }
);

scenario(
  `LiquidationBot > absorbs, but does not attempt to purchase collateral when maxAmountToPurchase=0`,
  {
    filter: async (ctx) => matchesDeployment(ctx, [{ network: 'mainnet' }, { network: 'polygon' }, { network: 'arbitrum' }]) && !matchesDeployment(ctx, [{deployment: 'wsteth', network: 'mainnet'}]),
    tokenBalances: {
      $comet: { $base: 100000 },
    },
    cometBalances: {
      albert: {
        $asset0: ' == 200',
      },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors }, _context, world) => {
    const { albert, betty } = actors;
    const { network, deployment } = world.deploymentManager;
    const flashLoanPool = flashLoanPools[network][deployment];
    const {
      balancerVault,
      uniswapRouter,
      uniswapV3Factory,
      sushiswapRouter,
      stakedNativeToken,
      weth9,
      wrappedStakedNativeToken
    } = addresses[network];

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/OnChainLiquidator.sol',
      [
        balancerVault,
        sushiswapRouter,
        uniswapRouter,
        uniswapV3Factory,
        stakedNativeToken,
        wrappedStakedNativeToken,
        weth9
      ]
    ) as OnChainLiquidator;

    const baseToken = await comet.baseToken();
    const { asset: collateralAssetAddress } = await comet.getAssetInfo(0);

    const initialRecipientBalance = await betty.getErc20Balance(baseToken);
    const [initialNumAbsorbs, initialNumAbsorbed] = await comet.liquidatorPoints(betty.address);

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

    await comet.connect(betty.signer).accrueAccount(albert.address); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

    const tx = await wait(liquidator.connect(betty.signer).absorbAndArbitrage(
      comet.address,
      [albert.address],
      [collateralAssetAddress],
      [getPoolConfig(collateralAssetAddress)],
      [0],
      flashLoanPool.tokenAddress,
      flashLoanPool.poolFee,
      10e6
    ));

    expect(event(tx, 3)).to.deep.equal({
      Absorb: {
        initiator: betty.address,
        accounts: [albert.address]
      }
    });

    // confirm that Albert position has been abosrbed
    expect(await comet.isLiquidatable(albert.address)).to.be.false;
    expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

    // confirm that collateral was not purchased
    expect(event(tx, 4)).to.deep.equal({
      AbsorbWithoutBuyingCollateral: {}
    });

    // confirm that liquidator points increased by 1
    const [finalNumAbsorbs, finalNumAbsorbed] = await comet.liquidatorPoints(betty.address);
    expect(finalNumAbsorbs).to.be.greaterThan(initialNumAbsorbs);
    expect(finalNumAbsorbed).to.be.greaterThan(initialNumAbsorbed);

    // confirm that protocol reserves have decreased
    expect(await comet.getReserves()).to.be.below(initialReserves);

    // check that recipient balance has stayed the same
    expect(await betty.getErc20Balance(baseToken)).to.be.eq(Number(initialRecipientBalance));
  }
);

{
  const baseTokenBalances = {
    mainnet: {
      usdc: 2250000,
      weth: 20,
      usdt: 2250000
    },
  };
  const assetAmounts = {
    mainnet: {
      usdc: ' == 5000', // COMP
      weth: ' == 7000', // CB_ETH
      usdt: ' == 5000', // COMP
    },
  };

  scenario(
    `LiquidationBot > reverts when price slippage is too high`,
    {
      upgrade: {
        targetReserves: exp(20_000, 18)
      },
      filter: async (ctx) => matchesDeployment(ctx, [{ network: 'mainnet' }]) && !matchesDeployment(ctx, [{deployment: 'wsteth'}]),
      tokenBalances: async (ctx) => (
        {
          $comet: {
            $base: baseTokenBalances[ctx.world.base.network]?.[ctx.world.base.deployment] || 0,
          },
        }
      ),
      cometBalances: async (ctx) => (
        {
          albert: {
            $asset0: assetAmounts[ctx.world.base.network]?.[ctx.world.base.deployment] || 0
          },
        }
      ),
    },
    async ({ comet, actors }, _context, world) => {
      const { albert, betty } = actors;
      const { network, deployment } = world.deploymentManager;
      const flashLoanPool = flashLoanPools[network][deployment];
      const {
        balancerVault,
        uniswapRouter,
        uniswapV3Factory,
        sushiswapRouter,
        stakedNativeToken,
        weth9,
        wrappedStakedNativeToken
      } = addresses[network];

      const liquidator = await world.deploymentManager.deploy(
        'liquidator',
        'liquidator/OnChainLiquidator.sol',
        [
          balancerVault,
          sushiswapRouter,
          uniswapRouter,
          uniswapV3Factory,
          stakedNativeToken,
          wrappedStakedNativeToken,
          weth9
        ]
      ) as OnChainLiquidator;

      const baseToken = await comet.baseToken();
      const { asset: collateralAssetAddress } = await comet.getAssetInfo(0);

      const initialRecipientBalance = await betty.getErc20Balance(baseToken);
      const [initialNumAbsorbs, initialNumAbsorbed] = await comet.liquidatorPoints(betty.address);

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

      await comet.connect(betty.signer).accrueAccount(albert.address); // force accrue

      expect(await comet.isLiquidatable(albert.address)).to.be.true;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

      await expect(
        liquidator.connect(betty.signer).absorbAndArbitrage(
          comet.address,
          [albert.address],
          [collateralAssetAddress],
          [getPoolConfig(collateralAssetAddress)],
          [ethers.constants.MaxUint256],
          flashLoanPool.tokenAddress,
          flashLoanPool.poolFee,
          10e6
        )
      ).to.be.revertedWithCustomError(liquidator, 'InsufficientAmountOut');

      // confirm that Albert position has not been abosrbed
      expect(await comet.isLiquidatable(albert.address)).to.be.true;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

      // confirm that liquidator points have not increased
      const [finalNumAbsorbs, finalNumAbsorbed] = await comet.liquidatorPoints(betty.address);
      expect(finalNumAbsorbs).to.eq(initialNumAbsorbs);
      expect(finalNumAbsorbed).to.eq(initialNumAbsorbed);

      // check that recipient balance has stayed the same
      expect(await betty.getErc20Balance(baseToken)).to.be.eq(Number(initialRecipientBalance));
    }
  );
}

// XXX test that Liquidator liquidates up to the max amount for that asset