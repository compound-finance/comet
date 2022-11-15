import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { isValidAssetIndex, MAX_ASSETS, timeUntilUnderwater } from './utils';

const daiPool = {
  tokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  poolFee: 100
};

const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const RECIPIENT = '0xe8F0c9059b8Db5B863d48dB8e8C1A09f97D3B991';
const UNISWAP_ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564';
const SUSHISWAP_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

enum Exchange {
  Uniswap,
  SushiSwap
}

for (let i = 0; i < MAX_ASSETS; i++) {
  const borrowPositions = [
    // COMP
    {
      baseBorrowAmount: 20_000n,
      assetAmount: ' == 1000'
    },
    // WBTC
    {
      baseBorrowAmount: 1_300_000n,
      assetAmount: ' == 120'
    },
    // WETH
    {
      baseBorrowAmount: 5_000_000n,
      assetAmount: ' == 5000'
    },
    // UNI
    {
      baseBorrowAmount: 700_000n,
      assetAmount: ' == 150000'
    },
    // LINK
    {
      baseBorrowAmount: 1_000_000n,
      assetAmount: ' == 250000'
    },
  ];
  scenario.only(
    `LiquidationBot > liquidates an underwater position for $asset${i}`,
    {
      filter: async (ctx) => ctx.world.base.network === 'mainnet' && await isValidAssetIndex(ctx, i),
      tokenBalances: {
        $comet: { $base: 1000 },
      },
      cometBalances: {
        albert: {
          [`$asset${i}`]: borrowPositions[i]?.assetAmount || 0
        },
        betty: { $base: 1230 },
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
          ]
        ]
      );

      const initialRecipientBalance = await USDC.balanceOf(RECIPIENT);

      const baseToken = await comet.baseToken();
      const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
      const baseScale = await comet.baseScale();
      const { asset: collateralAssetAddress } = await comet.getAssetInfo(i);

      await albert.withdrawAsset({
        asset: baseToken,
        amount: baseScale.mul(borrowPositions[i]?.baseBorrowAmount || 0n)
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

      expect(await comet.isLiquidatable(albert.address)).to.be.false;
      expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.eq(0);

      // XXX confirm that protocol reserves have increased

      // check that recipient balance increased
      expect(await USDC.balanceOf(RECIPIENT)).to.be.greaterThan(Number(initialRecipientBalance));
    }
  );
}