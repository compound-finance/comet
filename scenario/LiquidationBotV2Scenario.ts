import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { LiquidatorV2 } from '../build/types';
import { attemptLiquidation } from '../scripts/liquidation_bot/liquidateUnderwaterBorrowers';
import { isValidAssetIndex, MAX_ASSETS, timeUntilUnderwater } from './utils';

const LIQUIDATOR_EOA = "0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F";
const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

for (let i = 0; i < MAX_ASSETS; i++) {
  const assetAmounts = [
    // COMP
    500,
    // WBTC
    120,
    // WETH
    5000,
    // UNI
    150000,
    // LINK
    250000,
  ];

  scenario(
    `LiquidationBotV2 > liquidates an underwater position of $asset${i} ${assetAmounts[i] || ''} with no maxCollateralPurchase`,
    {
      filter: async (ctx) => ctx.world.base.network === 'mainnet' && await isValidAssetIndex(ctx, i),
      tokenBalances: {
        albert: {
          [`$asset${i}`]: assetAmounts[i] ? ` == ${assetAmounts[i]}` : 0
        },
      },
    },
    async ({ comet, actors, assets }, _context, world) => {
      const { albert, betty } = actors;
      const { USDC } = assets;

      const liquidator = await world.deploymentManager.deploy(
        'liquidator',
        'liquidator/LiquidatorV2.sol',
        [
          comet.address,
          UNISWAP_V3_FACTORY_ADDRESS, // _factory
          WETH9, // _WETH9
          LIQUIDATOR_EOA // recipient
        ]
      ) as LiquidatorV2;

      const initialRecipientBalance = await USDC.balanceOf(LIQUIDATOR_EOA);
      const initialReserves = (await comet.getReserves()).toBigInt();

      const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(i);

      // transfer an amount of the asset to the protocol, so it will sell
      await albert.transferErc20(
        collateralAssetAddress,
        comet.address,
        scale.mul(assetAmounts[i]).toBigInt()
      );

      await attemptLiquidation(
        comet,
        liquidator,
        [],
        {
          signer: betty.signer
        },
        'mainnet'
      );

      // confirm that protocol reserves have increased
      expect(await comet.getReserves()).to.be.above(initialReserves);

      // confirm is not holding a significant amount of the collateral asset
      expect(await comet.getCollateralReserves(collateralAssetAddress)).to.be.below(scale);

      // check that recipient balance increased
      expect(await USDC.balanceOf(LIQUIDATOR_EOA)).to.be.greaterThan(Number(initialRecipientBalance));
    }
  )
}