import { scenario } from './context/CometContext';
import { CometInterface } from '../build/types';
import CometActor from './context/CometActor';
import { event, expect } from '../test/helpers';
import { expectRevertCustom } from './utils';

async function getLiquidationMargin({ comet, actor, baseLiquidity, factorScale }): Promise<bigint> {
  const numAssets = await comet.numAssets();
  let liquidity = baseLiquidity;
  for (let i = 0; i < numAssets; i++) {
    const { asset, priceFeed, scale, liquidateCollateralFactor } = await comet.getAssetInfo(i);
    const collatBalance = (await comet.collateralBalanceOf(actor.address, asset)).toBigInt();
    const collatPrice = (await comet.getPrice(priceFeed)).toBigInt();
    const collatValue = collatBalance * collatPrice / scale.toBigInt();
    liquidity += collatValue * liquidateCollateralFactor.toBigInt() / factorScale;
  }

  return liquidity;
}

/*
invariant:
((borrowRate / factorScale) * timeElapsed) * (baseBalanceOf * price / baseScale) = -liquidationMargin

isolating for timeElapsed:
timeElapsed = -liquidationMargin / (baseBalanceOf * price / baseScale) / (borrowRate / factorScale);
*/
async function timeUntilUnderwater({ comet, actor, fudgeFactor = 0n }: { comet: CometInterface, actor: CometActor, fudgeFactor?: bigint }): Promise<number> {
  const baseBalance = await actor.getCometBaseBalance();
  const baseScale = (await comet.baseScale()).toBigInt();
  const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
  const baseLiquidity = baseBalance * basePrice / baseScale;
  const utilization = await comet.getUtilization();
  const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();
  const factorScale = (await comet.factorScale()).toBigInt();
  const liquidationMargin = await getLiquidationMargin({ comet, actor, baseLiquidity, factorScale });

  if (liquidationMargin < 0) {
    return 0; // already underwater
  }

  // XXX throw error if baseBalanceOf is positive and liquidationMargin is positive
  return Number((-liquidationMargin * factorScale / baseLiquidity / borrowRate) + fudgeFactor);
}

scenario(
  'Comet#liquidation > isLiquidatable=true for underwater position',
  {
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: { $base: -1000 },
      betty: { $base: 1000 },
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;
    const baseToken = await comet.baseToken();
    const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
  }
);

scenario(
  'Comet#liquidation > prevents liquidation when absorb is paused',
  {
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: { $base: -1000 },
      betty: { $base: 1000 }
    },
    pause: {
      absorbPaused: true,
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;
    const baseToken = await comet.baseToken();
    const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

    await expectRevertCustom(
      betty.absorb({ absorber: betty.address, accounts: [albert.address] }),
      'Paused()'
    );
  }
);

scenario(
  'Comet#liquidation > allows liquidation of underwater positions',
  {
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: {
        $base: -1000,
        $asset0: .001
      },
      betty: { $base: 10 }
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    const lp0 = await comet.liquidatorPoints(betty.address);

    await betty.absorb({ absorber: betty.address, accounts: [albert.address] });

    const lp1 = await comet.liquidatorPoints(betty.address);

    // increments absorber's numAbsorbs
    expect(lp1.numAbsorbs).to.eq(lp0.numAbsorbs + 1);
    // increases absorber's numAbsorbed
    expect(lp1.numAbsorbed.toNumber()).to.eq(lp0.numAbsorbed.toNumber() + 1);
    // XXX test approxSpend?

    const baseBalance = await albert.getCometBaseBalance();
    expect(Number(baseBalance)).to.be.greaterThanOrEqual(0);

    // clears out all of liquidated user's collateral
    const numAssets = await comet.numAssets();
    for (let i = 0; i < numAssets; i++) {
      const { asset } = await comet.getAssetInfo(i);
      expect(await comet.collateralBalanceOf(albert.address, asset)).to.eq(0);
    }

    // clears assetsIn
    expect((await comet.userBasic(albert.address)).assetsIn).to.eq(0);
  }
);

scenario(
  'Comet#liquidation > user can end up with a minted supply',
  {
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: {
        $base: -1000,
        $asset0: 0.001
      },
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
      })
    );

    const ab0 = await betty.absorb({ absorber: betty.address, accounts: [albert.address] });
    expect(ab0.events?.[2]?.event).to.be.equal('Transfer');

    const baseBalance = await albert.getCometBaseBalance();
    expect(Number(baseBalance)).to.be.greaterThan(0);
  }
);

// XXX Skipping temporarily because testnet is in a weird state where an EOA ('admin') still
// has permission to withdraw Comet's collateral, while Timelock does not. This is because the
// permission was set up in the initialize() function. There is currently no way to update this
// permission in Comet, so a new function (e.g. `approveCometPermission`) needs to be created
// to allow governance to modify which addresses can withdraw assets from Comet's Comet balance.
scenario.skip(
  'Comet#liquidation > governor can withdraw collateral after successful liquidation',
  {
    cometBalances: {
      albert: {
        $base: -10,
        $asset0: .001
      },
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, charles } = actors;
    const { asset: asset0Address, scale } = await comet.getAssetInfo(0);

    const collateralBalance = scale.toBigInt() / 1000n; // .001

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    await betty.absorb({ absorber: betty.address, accounts: [albert.address] });

    const txReceipt = await charles.withdrawAssetFrom({
      src: comet.address,
      dst: charles.address,
      asset: asset0Address,
      amount: collateralBalance
    });

    expect(event({ receipt: txReceipt }, 0)).to.deep.equal({
      Transfer: {
        from: comet.address,
        to: charles.address,
        amount: collateralBalance
      }
    });

    expect(event({ receipt: txReceipt }, 1)).to.deep.equal({
      WithdrawCollateral: {
        src: comet.address,
        to: charles.address,
        asset: asset0Address,
        amount: collateralBalance
      }
    });
  }
);