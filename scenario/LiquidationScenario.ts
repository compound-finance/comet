import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { exp } from '../test/helpers';
import { CometInterface } from '../build/types';
import CometActor from './context/CometActor';

/*
invariant:
((borrowRate / factorScale) * timeElapsed) * (baseBalanceOf * price / baseScale) = -(getBorrowLiquidity)

isolating for timeElapsed:
timeElapsed = -borrowLiquidity / (baseBalanceOf * price / baseScale) / (borrowRate / factorScale);

// const timeElapsed = -borrowLiquidity * factorScale * baseScale / (baseBalanceOf * price) / borrowRate; // fudge factor
*/
async function timeUntilUnderwater({comet, actor}: {comet: CometInterface, actor: CometActor}): Promise<number> {
  const liquidationMargin = (await (await comet.getLiquidationMargin(actor.address)).toBigInt());
  const baseBalanceOf = (await comet.baseBalanceOf(actor.address)).toBigInt();
  const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
  const borrowRate = (await comet.getBorrowRate()).toBigInt();
  const baseScale = (await comet.baseScale()).toBigInt();
  const factorScale = (await comet.factorScale()).toBigInt();

  // XXX add as parameter
  const fudgeFactor = 0n;

  // XXX throw error if baseBalanceOf is positive

  return Number((-liquidationMargin * factorScale * baseScale /
          (baseBalanceOf * basePrice) /
          borrowRate) + fudgeFactor);
}

scenario(
  'Comet#liquidation > isLiquidatable=true for underwater position',
  {
    cometBalances: {
      albert: { $base: -10000 }, // in units of asset, not wei
      betty: { $base: 100 } // in units of asset, not wei
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
  'Comet#liquidation > prevents liquidation when absord is paused',
  {
    cometBalances: {
      albert: { $base: -10000 }, // in units of asset, not wei
      betty: { $base: 100 } // in units of asset, not wei
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

scenario.only(
  'Comet#liquidation > allows liquidation of underwater positions',
  {
    cometBalances: {
      albert: { $base: -10000 }, // in units of asset, not wei
      betty: { $base: 100 } // in units of asset, not wei
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



// XXX liquidation scenarios
// XXX ensure governor can withdrawCollateral after successful liquidation
//   'Comet#liquidation > governor can withdraw collateral after',
/*
    // console.log(`comet.isLiquidatable(albert.address): ${await comet.isLiquidatable(albert.address)}`);
    // console.log(`await comet.getLiquidationMargin(): ${await comet.getLiquidationMargin(albert.address)}`);
    // console.log(`comet.getBorrowLiquidity(albert.address): ${await comet.getBorrowLiquidity(albert.address)}`);



scenario.only(
  'Comet#liquidation > governor can withdraw collateral after',
  {
    // baseToken: {
    //   balance: 100e6,
    // },
    cometBalances: {
      albert: { $base: -10000 }, // in units of asset, not wei // storage value in Comet
      betty: { $base: 100}
    },
    utilization: 1
  },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;
    const baseToken = await comet.baseToken();

    const borrowLiquidity = (await comet.getBorrowLiquidity(albert.address)).toBigInt();
    const liquidationMargin = (await (await comet.getLiquidationMargin(albert.address)).toBigInt());
    const baseBalanceOf = (await comet.baseBalanceOf(albert.address)).toBigInt();
    const price = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
    const borrowRate = (await comet.getBorrowRate()).toBigInt();
    const baseScale = (await comet.baseScale()).toBigInt();
    const factorScale = (await comet.factorScale()).toBigInt();

    const timeElapsed = timeUntilUnderwater({
      baseBalanceOf,
      baseScale,
      liquidationMargin,
      borrowRate,
      factorScale,
      price,
    });

    const timeElapsed2 = await timeUntilUnderwater2({
      comet,
      actor: albert
    });

    console.log(`timeElapsed: ${timeElapsed}`);
    console.log(`timeElapsed2: ${timeElapsed2}`);

    await world.increaseTime(Number(timeElapsed));

    await comet.connect(betty.signer).withdraw(baseToken, 10); // force accrue

    console.log(`comet.isLiquidatable(albert.address): ${await comet.isLiquidatable(albert.address)}`);
    console.log(`await comet.getLiquidationMargin(): ${await comet.getLiquidationMargin(albert.address)}`);
    console.log(`comet.getBorrowLiquidity(albert.address): ${await comet.getBorrowLiquidity(albert.address)}`);

    expect(true).to.be.false;
  }
);
*/