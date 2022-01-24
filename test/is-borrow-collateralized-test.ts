import { expect, exp, makeProtocol } from './helpers';
import { BigNumber } from 'ethers';

describe.only('getBorrowLiquidity', function () {
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

  /*
  it.skip('changes when the underlying asset price changes', async () => {
    const borrowCF = 1;
    const protocol = await makeProtocol({
      base: 'USDC',
      assets: {
        COMP: { initial: 1e7, decimals: 18, borrowCF },
        USDC: { initial: 1e6, decimals: 6 },
        WETH: { initial: 1e4, decimals: 18 },
        WBTC: { initial: 1e3, decimals: 8 },
      },
    });
    const {
      comet,
      tokens,
      users: [alice],
    } = protocol;
    const { USDC, COMP } = tokens;

    // await oracle.setPrice(USDC.address, 1);
    // await oracle.setPrice(COMP.address, 10);

    const collateralBalance = 10;

    await comet.setCollateralBalance(alice.address, COMP.address, collateralBalance);

    // price (10) * collateral balance (10) = 100
    expect(await comet.liquidityForAccount(alice.address)).to.equal(100);

    // price (5) * collateral balance (10) = 50
    // await oracle.setPrice(COMP.address, 5);

    expect(await comet.liquidityForAccount(alice.address)).to.equal(50);
  });
});

describe.only('isBorrowCollateralized', function () {
  it.skip('defaults to true', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      users: [alice],
    } = protocol;

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it.skip('is true when user is owed principal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      tokens,
      users: [alice],
    } = protocol;
    const { USDC } = tokens;

    // await oracle.setPrice(USDC.address, 1);

    await comet.setBasePrincipal(alice.address, 10);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it.skip('is false when user owes principal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      tokens,
      users: [alice],
    } = protocol;
    const { USDC } = tokens;

    // await oracle.setPrice(USDC.address, 1);

    await comet.setBasePrincipal(alice.address, -10);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });

  it.skip('changes when the underlying asset price changes', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      assets: {
        COMP: { initial: 1e7, decimals: 18, borrowCF: 1 },
        USDC: { initial: 1e6, decimals: 6 },
        WETH: { initial: 1e4, decimals: 18 },
        WBTC: { initial: 1e3, decimals: 8 },
      },
    });
    const {
      comet,
      tokens,
      users: [alice],
    } = protocol;
    const { USDC, COMP } = tokens;

    // USDC and COMP have same price; borrow collateral factor is 1
    // await oracle.setPrice(USDC.address, 10);
    // await oracle.setPrice(COMP.address, 10);

    // user has borrowed 100 USDC
    await comet.setBasePrincipal(alice.address, -100);

    await comet.setCollateralBalance(alice.address, COMP.address, 100);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;

    // price drop puts user's collateral below the borrow collateral factor
    // await oracle.setPrice(COMP.address, 9);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  */
});
