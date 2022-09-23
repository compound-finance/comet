import { expect, exp, makeProtocol } from './helpers';

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

    await priceFeeds.COMP.setRoundData(
      0,           // roundId
      exp(0.5, 8), // answer
      0,           // startedAt
      0,           // updatedAt
      0            // answeredInRound
    );

    expect(await comet.isBorrowCollateralized(alice.address)).to.be.false;
  });
});
