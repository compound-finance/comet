import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { LiquidatorV2 } from '../build/types';
import { attemptLiquidation } from '../scripts/liquidation_bot/liquidateUnderwaterBorrowers';
import CometActor from './context/CometActor';
import { CometInterface } from '../build/types';
import { isValidAssetIndex, MAX_ASSETS, timeUntilUnderwater } from './utils';
import { exp } from '../test/helpers';

const LIQUIDATOR_EOA = "0x5a13D329A193ca3B1fE2d7B459097EdDba14C28F";
const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

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

    // XXX delete
    const i = 1;

    const { asset: collateralAssetAddress, scale } = await comet.getAssetInfo(i);

    await albert.transferErc20(WBTC.address, comet.address, exp(120, 8));

    await attemptLiquidation(
      comet,
      liquidator,
      [],
      {
        signer: charles.signer
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