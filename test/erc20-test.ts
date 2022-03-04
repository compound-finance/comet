import { expect, makeProtocol } from './helpers';

describe('erc20', function () {
  it('has correct name', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.name()).to.be.equal("Compound Comet");
  });

  it('has correct symbol', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.symbol()).to.be.equal("📈BASE");
  });

  it('has correct decimals', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.decimals()).to.be.equal(6);
  });

  it('has correct totalSupply', async () => {
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

    it('returns 0 (when principal amount is negative)', async () => {
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

  it('performs ERC20 transfer of base', async () => {
    const {
      comet,
      users: [alice, bob],
    } = await makeProtocol();

    expect(await comet.baseBalanceOf(bob.address)).to.eq(0);

    await comet.setBasePrincipal(alice.address, 100e6);

    await comet.connect(alice).transfer(bob.address, 100e6);

    expect(await comet.baseBalanceOf(bob.address)).to.eq(100e6);
    // XXX emits Transfer
  });

  it.skip('performs ERC20 transferFrom of base with approval', async () => {
    // XXX
    // XXX emits Approval
    // XXX check allowance()
  });

  it.skip('reverts ERC20 transferFrom without approval', async () => {
    // XXX
  });

  it.skip('reverts ERC20 transferFrom with revoked approval', async () => {
    // XXX
    // XXX emits Approval
    // XXX check allowance
  });
});
