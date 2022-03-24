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
  const liquidationMargin = (await (await comet.getLiquidationMargin(actor.address)).toBigInt());
  const baseBalanceOf = (await comet.baseBalanceOf(actor.address)).toBigInt();
  const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
  const borrowRate = (await comet.getBorrowRate()).toBigInt();
  const baseScale = (await comet.baseScale()).toBigInt();
  const factorScale = (await comet.factorScale()).toBigInt();

  // XXX throw error if baseBalanceOf is positive and liquidationMargin is positive
  return Number((-liquidationMargin * factorScale * baseScale /
          (baseBalanceOf * basePrice) /
          borrowRate) + fudgeFactor);
}

scenario(
  'Comet#liquidation > isLiquidatable=true for underwater position',
  {
    cometBalances: {
      albert: { $base: -10000 },
      betty: { $base: 100 }
    },
    utilization: 1
  },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;
    const baseToken = await comet.baseToken();

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert
      })
    );

    await comet.connect(betty.signer).withdraw(baseToken, 10); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
  }
);

scenario(
  'Comet#liquidation > prevents liquidation when absorb is paused',
  {
    cometBalances: {
      albert: { $base: -10000 },
      betty: { $base: 100 }
    },
    pause: {
      absorbPaused: true,
    },
    utilization: 1
  },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;
    const baseToken = await comet.baseToken();

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert
      })
    );

    await comet.connect(betty.signer).withdraw(baseToken, 10); // force accrue

    await expect(
      comet.absorb(betty.address, [albert.address])
    ).to.be.revertedWith("custom error 'Paused()'");
  }
);

scenario(
  'Comet#liquidation > allows liquidation of underwater positions',
  {
    cometBalances: {
      albert: { $base: -10000 },
    },
    utilization: 1
  },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;
    const baseToken = await comet.baseToken();

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert
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

    // clears liquidated user balance
    expect(await comet.baseBalanceOf(albert.address)).to.eq(0);
    // clears assetsIn
    expect((await comet.userBasic(albert.address)).assetsIn).to.eq(0);
  }
);

scenario(
  'Comet#liquidation > governor can withdraw collateral after successful liquidation',
  {
    balances: {
      albert: { $asset0: .001 }, // low value, to make it easy to source
    },
    cometBalances: {
      albert: { $base: -10000 },
    },
    utilization: 1
  },
  async ({ comet, actors }, world) => {
    const { albert, betty, admin } = actors;
    const baseToken = await comet.baseToken();
    const { asset: asset0Address, scale } = await comet.getAssetInfo(0);

    const collateralBalance = scale.toBigInt() / 1000n; // .001

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert
      })
    );

    await comet.absorb(betty.address, [albert.address]);

    const txReceipt = await admin.withdrawFrom({
      src: comet.address,
      to: admin.address,
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