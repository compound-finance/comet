import { ethers, expect, makeProtocol } from './helpers';

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

    expect(await comet.baseBalanceOf(alice.address)).to.eq(0);
    expect(await comet.baseBalanceOf(bob.address)).to.eq(100e6);
    // XXX emits Transfer
  });

  describe('transferFrom', function() {
    it('performs ERC20 transferFrom when user transfers their own funds', async () => {
      const {
        comet,
        users: [alice, bob],
      } = await makeProtocol();

      await comet.setBasePrincipal(alice.address, 100e6);

      await comet.connect(alice).transferFrom(alice.address, bob.address, 100e6)

      expect(await comet.baseBalanceOf(alice.address)).to.eq(0);
      expect(await comet.baseBalanceOf(bob.address)).to.eq(100e6);
    });

    it('reverts ERC20 transferFrom without approval', async () => {
      const {
        comet,
        users: [alice, bob],
      } = await makeProtocol();

      await comet.setBasePrincipal(alice.address, 100e6);

      await expect(
        comet.transferFrom(alice.address, bob.address, 100e6)
      ).to.be.revertedWith("custom error 'Unauthorized()'");
    });

    it('performs ERC20 transferFrom of base with approval', async () => {
      const {
        comet,
        users: [alice, bob],
      } = await makeProtocol();

      await comet.setBasePrincipal(alice.address, 100e6);

      // approving for uint256 = isAllowed[user][spender]=true
      await comet.connect(alice).approve(
        bob.address,
        ethers.constants.MaxUint256
      );
      // XXX emits Approval

      expect(await comet.allowance(alice.address, bob.address)).to.eq(ethers.constants.MaxUint256);

      await comet.connect(alice).transferFrom(alice.address, bob.address, 100e6);

      expect(await comet.baseBalanceOf(alice.address)).to.eq(0);
      expect(await comet.baseBalanceOf(bob.address)).to.eq(100e6);
    });

    it.skip('reverts ERC20 transferFrom with revoked approval', async () => {
      // XXX
      // XXX emits Approval
      // XXX check allowance
    });
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
      // XXX emits Approval

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
      // XXX emits Approval

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
