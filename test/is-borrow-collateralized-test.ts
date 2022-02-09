import { expect, exp, makeProtocol } from './helpers';

/*
Prices are set in terms of the base token (USDC with 6 decimals, by default):

  await comet.setBasePrincipal(alice.address, 1_000_000);

But the prices returned are denominated in terms of price scale (USD with 8
decimals, by default):

  expect(await comet.getBorrowLiquidity(alice.address)).to.equal(100_000_000);

*/

describe('getBorrowLiquidity', function () {
  it('defaults to 0', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(0);
  });

  it('is positive when user is owed principal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      users: [alice],
    } = protocol;

    await comet.setBasePrincipal(alice.address, 1_000_000);
    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(100_000_000);
  });

  it('is negative when user owes principal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      users: [alice],
    } = protocol;

    await comet.setBasePrincipal(alice.address, -1_000_000);

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(-100_000_000);
  });

  it('is increased when user has collateral balance', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1 },
      },
    });
    const { COMP } = tokens;

    await comet.setBasePrincipal(alice.address, 1_000_000);
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(199_990_000);
  });

  it("accounts for an asset's collateral factor", async () => {
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
          initialPrice: 1,
          borrowCF: exp(0.9, 18),
        },
      },
    });
    const { COMP } = tokens;

    await comet.setBasePrincipal(alice.address, 1_000_000);
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(190_000_000);
  });

  it('borrow collateral factor with multiple assets', async () => {
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
          initialPrice: 1,
          borrowCF: exp(0.9, 18),
        },
        WETH: {
          initial: 1e4,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
        },
      },
    });
    const { COMP, WETH } = tokens;

    await comet.setBasePrincipal(alice.address, 1_000_000);

    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));
    await comet.setCollateralBalance(alice.address, WETH.address, exp(1, 17));

    // 1 USDC = 1_000_000
    // 1 COMP * .9 collateral factor = 900_000
    // .1 WETH * .8 collateral factor = 80_000
    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(198_000_000);
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
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1, borrowCF: exp(0.9, 18) },
      },
    });
    const { COMP } = tokens;

    await comet.setBasePrincipal(alice.address, exp(1, 6));
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(
      // base + collateral * borrow CF * price
      exp(1, 8) + exp(1, 8) * 9n / 10n
    );

    await priceFeeds.COMP.setPrice(exp(0.5, 8));

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(
      // base + collateral * borrow CF * price
      exp(1, 8) + exp(1, 8) * 9n / 10n / 2n
    );
  });
});

describe('isBorrowCollateralized', function () {
  it('defaults to true', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      users: [alice],
    } = protocol;

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it('is true when user is owed principal', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol({ base: 'USDC' });
    await comet.setBasePrincipal(alice.address, 1_000_000);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it('is false when user owes principal', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol({ base: 'USDC' });

    await comet.setBasePrincipal(alice.address, -1_000_000);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });

  it('is true when value of collateral is greater than principal owed', async () => {
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
          borrowCF: exp(0.9, 18),
        },
      },
    });
    const { COMP } = tokens;

    // user owes 1 USDC, but has 1.2 COMP collateral
    await comet.setBasePrincipal(alice.address, -exp(1, 6));
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1.2, 18));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it('takes borrow collateral factor into account when valuing collateral', async () => {
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
          borrowCF: exp(0.9, 18),
        },
      },
    });
    const { COMP } = tokens;

    // user owes 1 USDC
    await comet.setBasePrincipal(alice.address, -1_000_000);
    // user has 1 COMP collateral, but the borrow collateral factor puts it
    // below the required collateral amount
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
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
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1, borrowCF: exp(0.2, 18) },
      },
    });
    const { COMP } = tokens;

    // user owes 1 USDC
    await comet.setBasePrincipal(alice.address, -exp(1, 6));
    // ...but has 5 COMP to cover their position
    await comet.setCollateralBalance(alice.address, COMP.address, exp(5, 18));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;

    await priceFeeds.COMP.setPrice(exp(0.5, 8));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });
});
