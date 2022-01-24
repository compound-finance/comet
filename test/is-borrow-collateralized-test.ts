import { expect, exp, makeProtocol } from './helpers';
import { BigNumber } from 'ethers';

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
});
