import { expect, makeProtocol } from './helpers';

describe('liquidityForAccount', function () {
  it('defaults to 0', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      users: [alice],
      oracle,
      tokens,
    } = protocol;
    const { USDC } = tokens;

    await oracle.setPrice(USDC.address, 1);

    expect(await comet.liquidityForAccount(alice.address)).to.equal(0);
  });

  it('is positive when user is owed principal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      tokens,
      users: [alice],
      oracle,
    } = protocol;
    const { USDC } = tokens;

    await oracle.setPrice(USDC.address, 1);

    await comet.setBasePrincipal(alice.address, 100);

    expect(await comet.liquidityForAccount(alice.address)).to.equal(100);
  });

  it('is negative when user owes principal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      tokens,
      users: [alice],
      oracle,
    } = protocol;
    const { USDC } = tokens;

    await oracle.setPrice(USDC.address, 1);

    await comet.setBasePrincipal(alice.address, -100);

    expect(await comet.liquidityForAccount(alice.address)).to.equal(-100);
  });

  it('is increased when user has collateral balance', async () => {
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
      oracle,
    } = protocol;
    const { USDC, COMP } = tokens;

    await oracle.setPrice(USDC.address, 1);
    await oracle.setPrice(COMP.address, 1);

    const collateralBalance = 10;

    await comet.setCollateralBalance(alice.address, COMP.address, collateralBalance);

    expect(await comet.liquidityForAccount(alice.address)).to.equal(borrowCF * collateralBalance);
  });

  it('changes when the underlying asset price changes', async () => {
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
      oracle,
    } = protocol;
    const { USDC, COMP } = tokens;

    await oracle.setPrice(USDC.address, 1);
    await oracle.setPrice(COMP.address, 10);

    const collateralBalance = 10;

    await comet.setCollateralBalance(alice.address, COMP.address, collateralBalance);

    // price (10) * collateral balance (10) = 100
    expect(await comet.liquidityForAccount(alice.address)).to.equal(100);

    // price (5) * collateral balance (10) = 50
    await oracle.setPrice(COMP.address, 5);

    expect(await comet.liquidityForAccount(alice.address)).to.equal(50);
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
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      tokens,
      users: [alice],
      oracle,
    } = protocol;
    const { USDC } = tokens;

    await oracle.setPrice(USDC.address, 1);

    await comet.setBasePrincipal(alice.address, 10);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;
  });

  it('is false when user owes principal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      tokens,
      users: [alice],
      oracle,
    } = protocol;
    const { USDC } = tokens;

    await oracle.setPrice(USDC.address, 1);

    await comet.setBasePrincipal(alice.address, -10);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });

  it('changes when the underlying asset price changes', async () => {
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
      oracle,
    } = protocol;
    const { USDC, COMP } = tokens;

    // USDC and COMP have same price; borrow collateral factor is 1
    await oracle.setPrice(USDC.address, 10);
    await oracle.setPrice(COMP.address, 10);

    // user has borrowed 100 USDC
    await comet.setBasePrincipal(alice.address, -100);

    await comet.setCollateralBalance(alice.address, COMP.address, 100);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.true;

    // price drop puts user's collateral below the borrow collateral factor
    await oracle.setPrice(COMP.address, 9);

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });
});
