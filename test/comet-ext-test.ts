import { expect, exp, makeProtocol } from './helpers';

describe('CometExt', function () {
  it('returns factor scale', async () => {
    const { comet } = await makeProtocol();
    const factorScale = await comet.factorScale();
    expect(factorScale).to.eq(exp(1, 18));
  });

  it('returns price scale', async () => {
    const { comet } = await makeProtocol();
    const priceScale = await comet.priceScale();
    expect(priceScale).to.eq(exp(1, 8));
  });

  it('returns totalSupply', async () => {
    const { comet } = await makeProtocol();

    let totalsBasic = await comet.totalsBasic();
    totalsBasic = Object.assign({}, totalsBasic, {
      totalSupplyBase: 100e6,
    });
    await comet.setTotalsBasic(totalsBasic);

    const totalSupply = await comet.totalSupply();

    expect(totalSupply).to.eq(100e6);
  });

  describe('balanceOf', function () {
    it('returns principal amount (when value is positive)', async () => {
      const {
        comet,
        users: [user],
      } = await makeProtocol();

      await comet.setBasePrincipal(user.address, 100e6);

      const balanceOf = await comet.balanceOf(user.address);
      expect(balanceOf).to.eq(100e6);
    });

    it.only('returns 0 (when principal amount is negative)', async () => {
      const {
        comet,
        users: [user],
      } = await makeProtocol();

      await comet.setBasePrincipal(user.address, -100e6);

      const balanceOf = await comet.balanceOf(user.address);
      expect(balanceOf).to.eq(0);
    });
  });

  describe('borrowBalanceOf', function () {
    it('returns borrow amount (when principal amount is negative)', async () => {
      const {
        comet,
        users: [user],
      } = await makeProtocol();

      await comet.setBasePrincipal(user.address, -100e6); // borrow of $100 USDC

      const borrowBalanceOf = await comet.borrowBalanceOf(user.address);
      expect(borrowBalanceOf).to.eq(100e6)
    });

    it('returns 0 when principal amount is positive', async () => {
      const {
        comet,
        users: [user],
      } = await makeProtocol();

      await comet.setBasePrincipal(user.address, 100e6);

      const borrowBalanceOf = await comet.borrowBalanceOf(user.address);
      expect(borrowBalanceOf).to.eq(0);
    });
  });

  it('returns principal baseBalanceOf', async () => {
    const {
      comet,
      users: [user],
    } = await makeProtocol();

    await comet.setBasePrincipal(user.address, 100e6);

    const baseBalanceOf = await comet.baseBalanceOf(user.address);
    expect(baseBalanceOf).to.eq(100e6);
  });
});
