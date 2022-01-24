import { expect, exp, makeProtocol } from './helpers';

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
    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(1_000_000);
  });

  it('is negative when user owes principal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      users: [alice],
    } = protocol;

    await comet.setBasePrincipal(alice.address, -1_000_000);

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(-1_000_000);
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

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(2_000_000);
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
          borrowCF: exp(9, 17), // .9
        },
      },
    });
    const { COMP } = tokens;

    await comet.setBasePrincipal(alice.address, 1_000_000);
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(1_900_000);
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
          borrowCF: exp(9, 17), // .9
        },
        WETH: {
          initial: 1e4,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(8, 17), // .8
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
    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(1_980_000);
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
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1 },
      },
    });
    const { COMP } = tokens;

    await comet.setBasePrincipal(alice.address, 1_000_000);
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

    // 1 USDC = 1_000_000
    // 1 COMP (at a price of 1) = 100_000
    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(2_000_000);

    await priceFeeds.COMP.setPrice(exp(0.5, 8));

    // 1 USDC = 1_000_000
    // 1 COMP (at a price of .5) = 500_000
    expect(await comet.getBorrowLiquidity(alice.address)).to.equal(1_500_000);
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
        },
      },
    });
    const { COMP } = tokens;

    // user owes 1 USDC, but has 1 COMP collateral
    await comet.setBasePrincipal(alice.address, -1_000_000);
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

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
          borrowCF: exp(9, 17), // .9
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
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1 },
      },
    });
    const { COMP } = tokens;

    // user owes 1 USDC
    await comet.setBasePrincipal(alice.address, -1_000_000);
    // ...but has 1 COMP of equivalent value to cover their position
    await comet.setCollateralBalance(alice.address, COMP.address, exp(1, 18));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;

    await priceFeeds.COMP.setPrice(exp(0.5, 8));

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });
});
