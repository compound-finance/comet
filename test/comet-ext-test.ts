import { ethers, expect, exp, makeProtocol } from './helpers';

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

  it('returns principal as baseBalanceOf', async () => {
    const {
      comet,
      users: [user],
    } = await makeProtocol();

    await comet.setBasePrincipal(user.address, 100e6);

    const baseBalanceOf = await comet.baseBalanceOf(user.address);
    expect(baseBalanceOf).to.eq(100e6);
  });

  it('returns collateralBalance (in units of the collateral asset)', async () => {
    const {
      comet,
      users: [user],
      tokens
    } = await makeProtocol();

    const { WETH } = tokens;

    await comet.setCollateralBalance(
      user.address,
      WETH.address,
      exp(5, 18)
    );

    const collateralBalanceOf = await comet.collateralBalanceOf(
      user.address,
      WETH.address
    );
    expect(collateralBalanceOf).to.eq(exp(5,18));
  });

  describe('approve', function() {
    it('sets isAllowed=true when user approves address for uint256 max', async () => {
      const {
        comet,
        users: [user, spender]
      } = await makeProtocol();

      await comet.connect(user).approve(
        spender.address,
        ethers.constants.MaxUint256
      );

      const isAllowed = await comet.isAllowed(user.address, spender.address);
      expect(isAllowed).to.be.true;
    });

    it('sets isAllowed=false when user passes 0', async () => {
      const {
        comet,
        users: [user, spender]
      } = await makeProtocol();

      await comet.connect(user).approve(
        spender.address,
        0
      );

      const isAllowed = await comet.isAllowed(user.address, spender.address);
      expect(isAllowed).to.be.false;
    });

    it('reverts when user approves for value that is not 0 or uint256.max', async () => {
      const {
        comet,
        users: [user, spender]
      } = await makeProtocol();

      await expect(
        comet.connect(user).approve(spender.address, 300)
      ).to.be.revertedWith('BadAmount()');
    });
  });

  describe('allowance', function() {
    it('returns unint256.max when spender has permission for user', async () => {
      const {
        comet,
        users: [user, spender]
      } = await makeProtocol();

      // authorize
      await comet.connect(user).allow(spender.address, true);

      const allowance = await comet.allowance(user.address, spender.address);
      expect(allowance).to.eq(ethers.constants.MaxUint256);
    });

    it('returns 0 when spender does not have permission for user', async () => {
      const {
        comet,
        users: [user, spender]
      } = await makeProtocol();

      // un-authorize
      await comet.connect(user).allow(spender.address, false);

      const allowance = await comet.allowance(user.address, spender.address);
      expect(allowance).to.eq(0);
    });
  });
});
