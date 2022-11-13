import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { Liquidator } from '../build/types';
import { timeUntilUnderwater } from './LiquidationScenario';

const daiPool = {
  tokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  poolFee: 100
};

// const LIQUIDATOR_ADDRESS = '0xb21b06D71c75973babdE35b49fFDAc3F82Ad3775'; // latest
// const LIQUIDATOR_ADDRESS = '0x42480C37B249e33aABaf4c22B20235656bd38068'; // previous

// XXX delete
const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const RECIPIENT = '0xe8F0c9059b8Db5B863d48dB8e8C1A09f97D3B991';
const SWAP_ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564';

scenario.only(
  'LiquidationBot > liquidates an underwater position',
  {
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: {
        $base: -10000,
        $asset0: 500
      },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors }, _context, world) => {
    const { albert, betty } = actors;

    // const liquidator = await world.deploymentManager.existing(
    //   'liquidator',
    //   LIQUIDATOR_ADDRESS
    // ) as Liquidator;

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/Liquidator.sol',
      [
        RECIPIENT, // _recipient
        SWAP_ROUTER, // _swapRouter
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
        ]
      ]
    );

    const baseToken = await comet.baseToken();
    const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
    const { asset: collateralAssetAddress } = await comet.getAssetInfo(0);

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
  });