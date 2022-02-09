import { expect, exp, makeProtocol } from './helpers';

/*
Prices are set in terms of the base token (USDC with 6 decimals, by default):

  await comet.setBasePrincipal(alice.address, 1_000_000);

But the prices returned are denominated in terms of price scale (USD with 8
decimals, by default):

  expect(await comet.getLiquidationMargin(alice.address)).to.equal(100_000_000);

*/

describe('getLiquidationMargin', function () {
  it('defaults to 0', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();

    expect(await comet.getLiquidationMargin(alice.address)).to.equal(0);
  });

  it('reflects a positive principal for account', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();

    // $1,000 in USDC
    await comet.setBasePrincipal(alice.address, 1_000_000_000);
    expect(await comet.getLiquidationMargin(alice.address)).to.equal(100_000_000_000);
  });

  it('reflects a negative principal for account', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();

    // -$1,000 in USDC
    await comet.setBasePrincipal(alice.address, -1_000_000_000);
    expect(await comet.getLiquidationMargin(alice.address)).to.equal(-100_000_000_000);
  });

  it('can cover a negative principal with collateral', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1 }, // 1 COMP = 1 USDC
      },
    });
    const { COMP } = tokens;

    // user owes $100,000 USDC (100_000 * 1e6)
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // user has $105,000 USDC worth of COMP
    await comet.setCollateralBalance(alice.address, COMP.address, exp(105_000, 18));

    // margin is $5,000 USDC (5_000 * 1e8)
    expect(await comet.getLiquidationMargin(alice.address)).to.equal(500_000_000_000);
  });

  it('can cover a borrow with multiple sources of collateral', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1 }, // 1 COMP = 1 USDC
        BAT: { initial: 1e7, decimals: 18, initialPrice: 1 }, // 1 BAT = 1 USDC
      },
    });
    const { COMP, BAT } = tokens;

    // user owes $500,000 USDC (500_000 * 1e6)
    await comet.setBasePrincipal(alice.address, -500_000_000_000);
    // user has $250,000 USDC worth of COMP
    await comet.setCollateralBalance(alice.address, COMP.address, exp(250_000, 18));
    // user has $251,000 USDC worth of BAT
    await comet.setCollateralBalance(alice.address, BAT.address, exp(251_000, 18));

    // margin is $1,000 USDC (1_000 * 1e8)
    expect(await comet.getLiquidationMargin(alice.address)).to.equal(100_000_000_000);
  });

  it('adjusts collateral by the liquidateCollateralFactor', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000 USDC (100_000 * 1e6)
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // user has $100,000 USDC worth of COMP
    await comet.setCollateralBalance(alice.address, COMP.address, exp(100_000, 18));

    // but their position is liquidatable, since the liquidate collateral factor is .8
    expect(await comet.getLiquidationMargin(alice.address)).to.equal(-2_000_000_000_000);
  });

  it('changes when the underlying asset price changes', async () => {
    const {
      comet,
      tokens,
      users: [alice],
      priceFeeds,
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
        },
      },
    });
    const { COMP } = tokens;

    // $100 worth of COMP
    await comet.setCollateralBalance(alice.address, COMP.address, exp(100, 18));
    expect(await comet.getLiquidationMargin(alice.address)).to.equal(10_000_000_000);

    // price of COMP now equal to 5 USDC
    await priceFeeds.COMP.setPrice(exp(5, 8));

    // Liquidation margin now reflect $500 worth of COMP
    expect(await comet.getLiquidationMargin(alice.address)).to.equal(50_000_000_000);
  });
});

describe('isLiquidatable', function () {
  it('defaults to false', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      users: [alice],
    } = protocol;

    expect(await comet.isLiquidatable(alice.address)).to.be.false;
  });

  it('is false when user is owed principal', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();
    await comet.setBasePrincipal(alice.address, 1_000_000);

    expect(await comet.isLiquidatable(alice.address)).to.be.false;
  });

  it('is true when user owes principal', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();
    await comet.setBasePrincipal(alice.address, -1_000_000);

    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });

  it('is false when collateral can cover the borrowed principal', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // but has $100,000 in COMP to cover
    await comet.setCollateralBalance(alice.address, COMP.address, exp(100_000, 18));

    expect(await comet.isLiquidatable(alice.address)).to.be.false;
  });

  it('is true when the collateral cannot cover the borrowed principal', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000 is
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // and only has $95,000 in COMP
    await comet.setCollateralBalance(alice.address, COMP.address, exp(95_000, 18));

    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });

  it('takes liquidateCollateralFactor into account when comparing principal to collateral', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.75, 18),
          liquidateCF: exp(0.8, 18),
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // has $100,000 in COMP to cover, but at a .8 liquidateCollateralFactor
    await comet.setCollateralBalance(alice.address, COMP.address, exp(100_000, 18));

    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });

  it('changes when the underlying asset price changes', async () => {
    const {
      comet,
      tokens,
      users: [alice],
      priceFeeds,
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
        },
      },
    });
    const { COMP } = tokens;

    // user owes $100,000
    await comet.setBasePrincipal(alice.address, -100_000_000_000);
    // has $100,000 in COMP to cover
    await comet.setCollateralBalance(alice.address, COMP.address, exp(100_000, 18));

    expect(await comet.isLiquidatable(alice.address)).to.be.false;

    // price drops
    await priceFeeds.COMP.setPrice(exp(0.5, 8));
    expect(await comet.isLiquidatable(alice.address)).to.be.true;
  });
});
