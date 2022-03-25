import { scenario } from './context/CometContext';
import { CometInterface } from '../build/types';
import CometActor from './context/CometActor';
import { event, expect } from '../test/helpers';

/*
invariant:
((borrowRate / factorScale) * timeElapsed) * (baseBalanceOf * price / baseScale) = -liquidationMargin

isolating for timeElapsed:
timeElapsed = -liquidationMargin / (baseBalanceOf * price / baseScale) / (borrowRate / factorScale);
*/
async function timeUntilUnderwater({comet, actor, fudgeFactor = 0n}: {comet: CometInterface, actor: CometActor, fudgeFactor?: bigint}): Promise<number> {
  const liquidationMargin = (await comet.getLiquidationMargin(actor.address)).toBigInt();
  const baseBalanceOf = (await comet.baseBalanceOf(actor.address)).toBigInt();
  const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
  const borrowRate = (await comet.getBorrowRate()).toBigInt();
  const baseScale = (await comet.baseScale()).toBigInt();
  const factorScale = (await comet.factorScale()).toBigInt();

  if (liquidationMargin < 0) {
    return 0; // already underwater
  }

  // XXX throw error if baseBalanceOf is positive and liquidationMargin is positive
  return Number((-liquidationMargin * factorScale * baseScale /
          (baseBalanceOf * basePrice) /
          borrowRate) + fudgeFactor);
}

scenario(
  'Comet#liquidation > isLiquidatable=true for underwater position',
  {
    tokenBalances: {
      $comet: { $base: 100 },
    },
    cometBalances: {
      albert: { $base: -10 },
      betty: { $base: 10 },
    },
  },
  async ({ comet, actors }, world) => {
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

    await betty.withdrawAsset({asset: baseToken, amount: baseBorrowMin}); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
  }
);

scenario(
  'Comet#liquidation > prevents liquidation when absorb is paused',
  {
    tokenBalances: {
      $comet: { $base: 100 },
    },
    cometBalances: {
      albert: { $base: -10 },
      betty: { $base: 10 }
    },
    pause: {
      absorbPaused: true,
    },
    upgrade: true
  },
  async ({ comet, actors }, world) => {
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

    await betty.withdrawAsset({asset: baseToken, amount: baseBorrowMin}); // force accrue

    await expect(
      comet.absorb(betty.address, [albert.address])
    ).to.be.revertedWith("custom error 'Paused()'");
  }
);

scenario(
  'Comet#liquidation > allows liquidation of underwater positions',
  {
    tokenBalances: {
      $comet: { $base: 100 },
    },
    cometBalances: {
      albert: { $base: -10 },
      betty: { $base: 10 }
    },
    upgrade: true
  },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    const lp0 = await comet.liquidatorPoints(betty.address);

    await comet.absorb(betty.address, [albert.address]);

    const lp1 = await comet.liquidatorPoints(betty.address);

    // increments absorber's numAbsorbs
    expect(lp1.numAbsorbs).to.eq(lp0.numAbsorbs + 1);
    // increases absorber's numAbsorbed
    expect(lp1.numAbsorbed.toNumber()).to.eq(lp0.numAbsorbed.toNumber() + 1);
    // XXX test approxSpend?

    const baseBalance = (await comet.baseBalanceOf(albert.address)).toNumber();
    expect(baseBalance).to.be.greaterThanOrEqual(0);

    // clears assetsIn
    expect((await comet.userBasic(albert.address)).assetsIn).to.eq(0);
  }
);

scenario(
  'Comet#liquidation > governor can withdraw collateral after successful liquidation',
  {
    cometBalances: {
      albert: {
        $base: -10,
        $asset0: .001
      },
    },
    upgrade: true
  },
  async ({ comet, actors }, world) => {
    const { albert, betty, admin } = actors;
    const { asset: asset0Address, scale } = await comet.getAssetInfo(0);

    const collateralBalance = scale.toBigInt() / 1000n; // .001

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    await comet.absorb(betty.address, [albert.address]);

    const txReceipt = await admin.withdrawAssetFrom({
      src: comet.address,
      dst: admin.address,
      asset: asset0Address,
      amount: collateralBalance
    });

    expect(event({receipt: txReceipt}, 0)).to.deep.equal({
      Transfer: {
        from: comet.address,
        to: admin.address,
        amount: collateralBalance
      }
    });

    expect(event({receipt: txReceipt}, 1)).to.deep.equal({
      WithdrawCollateral: {
        src: comet.address,
        to: admin.address,
        asset: asset0Address,
        amount: collateralBalance
      }
    });
  }
);