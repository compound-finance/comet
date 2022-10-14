import { baseBalanceOf, ethers, event, expect, makeProtocol, setTotalsBasic, wait } from './helpers';

describe('erc20', function () {
  it('has correct name', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.name()).to.be.equal('Compound Comet');
  });

  it('has correct symbol', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.symbol()).to.be.equal('📈BASE');
  });

  it('has correct decimals', async () => {
    const { comet } = await makeProtocol();

    expect(await comet.decimals()).to.be.equal(6);
  });

  it('has correct totalSupply', async () => {
    const { comet } = await makeProtocol();

    await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
      totalSupplyBase: 50e6,
    });

    const totalSupply = await comet.totalSupply();

    expect(totalSupply).to.eq(100e6);
  });

  describe('balanceOf', function () {
    it('returns presentValue of principal (when principal is positive)', async () => {
      const {
        comet,
        users: [user],
      } = await makeProtocol();

      await comet.setBasePrincipal(user.address, 100e6);

      let totalsBasic = await comet.totalsBasic();
      await setTotalsBasic(comet, {
        baseSupplyIndex: totalsBasic.baseSupplyIndex.mul(2),
      });

      const balanceOf = await comet.balanceOf(user.address);
      expect(balanceOf).to.eq(200e6);
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

  it('performs ERC20 transfer of base', async () => {
    const {
      comet,
      users: [alice, bob],
    } = await makeProtocol();

    expect(await baseBalanceOf(comet, bob.address)).to.eq(0n);

    await comet.setBasePrincipal(alice.address, 50e6);
    await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
    });

    const tx = await wait(comet.connect(alice).transfer(bob.address, 100e6));

    expect(await baseBalanceOf(comet, alice.address)).to.eq(0n);
    expect(await baseBalanceOf(comet, bob.address)).to.eq(BigInt(100e6));
    expect(event(tx, 0)).to.be.deep.equal({
      Transfer: {
        from: alice.address,
        to: ethers.constants.AddressZero,
        amount: BigInt(100e6),
      }
    });
    expect(event(tx, 1)).to.be.deep.equal({
      Transfer: {
        from: ethers.constants.AddressZero,
        to: bob.address,
        amount: BigInt(100e6),
      }
    });
  });

  describe('transferFrom', function() {
    it('performs ERC20 transferFrom when user transfers their own funds', async () => {
      const {
        comet,
        users: [alice, bob],
      } = await makeProtocol();

      await comet.setBasePrincipal(alice.address, 50e6);
      await setTotalsBasic(comet, {
        baseSupplyIndex: 2e15,
      });

      await comet.connect(alice).transferFrom(alice.address, bob.address, 100e6);

      expect(await baseBalanceOf(comet, alice.address)).to.eq(0n);
      expect(await baseBalanceOf(comet, bob.address)).to.eq(BigInt(100e6));
    });

    it('reverts ERC20 transferFrom without approval', async () => {
      const {
        comet,
        users: [alice, bob],
      } = await makeProtocol();

      await comet.setBasePrincipal(alice.address, 100e6);

      await expect(
        comet.connect(bob).transferFrom(alice.address, bob.address, 100e6)
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

      expect(await comet.allowance(alice.address, bob.address)).to.eq(ethers.constants.MaxUint256);

      // bob can now transfer funds from alice
      await comet.connect(bob).transferFrom(alice.address, bob.address, 100e6);

      expect(await baseBalanceOf(comet, alice.address)).to.eq(0n);
      expect(await baseBalanceOf(comet, bob.address)).to.eq(BigInt(100e6));
    });

    it('reverts ERC20 transferFrom with revoked approval', async () => {
      const {
        comet,
        users: [alice, bob],
      } = await makeProtocol();

      await comet.setBasePrincipal(alice.address, 100e6);

      // bob is approved
      await comet.connect(alice).approve(
        bob.address,
        ethers.constants.MaxUint256
      );

      expect(await comet.allowance(alice.address, bob.address)).to.eq(ethers.constants.MaxUint256);

      // approval is revoked
      await comet.connect(alice).approve(bob.address, 0);

      expect(await comet.allowance(alice.address, bob.address)).to.eq(0);

      // bob cannot transfer funds from alice
      await expect(
        comet.connect(bob).transferFrom(alice.address, bob.address, 100e6)
      ).to.be.revertedWith("custom error 'Unauthorized()'");
    });
  });

  describe('approve', function() {
    it('sets isAllowed=true when user approves address for uint256 max', async () => {
      const {
        comet,
        users: [user, spender]
      } = await makeProtocol();

      const MaxU256 = BigInt(ethers.constants.MaxUint256.toString());
      const tx = await wait(comet.connect(user).approve(spender.address, MaxU256));
      expect(event(tx, 0)).to.be.deep.equal({
        Approval: {
          owner: user.address,
          spender: spender.address,
          amount: MaxU256,
        }
      });

      const isAllowed = await comet.isAllowed(user.address, spender.address);
      expect(isAllowed).to.be.true;
    });

    it('sets isAllowed=false when user passes 0', async () => {
      const {
        comet,
        users: [user, spender]
      } = await makeProtocol();

      const tx = await wait(comet.connect(user).approve(spender.address, 0));
      expect(event(tx, 0)).to.be.deep.equal({
        Approval: {
          owner: user.address,
          spender: spender.address,
          amount: BigInt(0),
        }
      });

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
      ).to.be.revertedWith("custom error 'BadAmount()'");
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
