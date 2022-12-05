import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { LiquidatorV2 } from '../build/types';
import { attemptLiquidation } from '../scripts/liquidation_bot/liquidateUnderwaterBorrowers';
import CometActor from './context/CometActor';
import { CometInterface } from '../build/types';
import { isValidAssetIndex, MAX_ASSETS, timeUntilUnderwater } from './utils';
import { exp } from '../test/helpers';

const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

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

scenario.only(
  'LiquidationBotV2 > XXX TEST',
  {
    tokenBalances: {
      albert: {
        $asset1: ' == 120'
      },
    },
  },
  async ({ comet, actors, assets }, context, world) => {
    const { albert, betty, charles } = actors;
    const { USDC, COMP, WBTC, WETH, UNI, LINK } = assets;

    console.log(`await world.timestamp():`);
    console.log(await world.timestamp());

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/LiquidatorV2.sol',
      [
        comet.address,
        UNISWAP_V3_FACTORY_ADDRESS, // _factory
        WETH9, // _WETH9
        "0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F" // recipient
      ]
    ) as LiquidatorV2;

    console.log(`await world.timestamp():`);
    console.log(await world.timestamp());

    await albert.transferErc20(WBTC.address, comet.address, exp(120, 8));

    // const baseToken = await comet.baseToken();
    // const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();

    // const i = 1; // XXX

    // const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(i);
    // const borrowCapacity = await borrowCapacityForAsset(comet, albert, i);
    // const borrowAmount = (borrowCapacity.mul(90n)).div(100n);

    // // Do a manual withdrawAsset (instead of setting $base to a negative
    // // number) so we can confirm that albert only has one type of collateral asset
    // await albert.withdrawAsset({
    //   asset: baseToken,
    //   amount: borrowAmount
    // });

    // await world.increaseTime(
    //   await timeUntilUnderwater({
    //     comet,
    //     actor: albert,
    //     fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
    //   })
    // );

    // await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

    // expect(await comet.isLiquidatable(albert.address)).to.be.true;
    // expect(await comet.collateralBalanceOf(albert.address, collateralAssetAddress)).to.be.greaterThan(0);

    // console.log(`await world.timestamp():`);
    // console.log(await world.timestamp());

    // await context.setNextBlockTimestamp(16093122);

    // console.log(`await world.timestamp():`);
    // console.log(await world.timestamp());

    await attemptLiquidation(
      comet,
      liquidator,
      [
        // albert.address
      ],
      {
        signer: charles.signer
      },
      'mainnet'
    );
  }
)