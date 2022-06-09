import { expect, makeProtocol, setTotalsBasic } from './helpers';

describe('totalBorrow', function () {
  it('has correct totalBorrow', async () => {
    const { comet } = await makeProtocol();
    await setTotalsBasic(comet, {
      baseBorrowIndex: 2e15,
      totalBorrowBase: 50e6,
    });
    expect(await comet.totalBorrow()).to.eq(100e6);
  });
});

describe('borrowBalanceOf', function () {
  it('returns borrow amount (when principal amount is negative)', async () => {
    const { comet, users: [user] } = await makeProtocol();
    await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 3e15,
    });
    await comet.setBasePrincipal(user.address, -100e6); // borrow of $100 USDC
    const borrowBalanceOf = await comet.borrowBalanceOf(user.address);
    expect(borrowBalanceOf).to.eq(300e6); // baseSupplyIndex = 3e15
  });

  it('returns 0 when principal amount is positive', async () => {
    const { comet, users: [user] } = await makeProtocol();
    await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 3e15,
    });
    await comet.setBasePrincipal(user.address, 100e6);
    const borrowBalanceOf = await comet.borrowBalanceOf(user.address);
    expect(borrowBalanceOf).to.eq(0);
  });
});

// XXX test implicit interest accrual explicitly