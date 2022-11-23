import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { isValidAssetIndex, MAX_ASSETS, timeUntilUnderwater } from './utils';
import { constants } from 'ethers';
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
  scenario.only(
    `LiquidationBotV2 > liquidates an underwater position of $asset${i} ${assetAmounts[i] || ''} with no maxCollateralPurchase`,
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
            COMP.address,
            WBTC.address,
            WETH.address,
            UNI.address,
            LINK.address,
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