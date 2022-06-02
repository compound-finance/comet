import { event, expect, makeProtocol, setTotalsBasic, wait } from './helpers';

describe('withdrawReserves', function () {
  it('withdraws reserves from the protocol', async () => {
    const tokenBalance = 1000n;
    const {
      comet,
      tokens: { USDC },
      users: [alice],
      governor,
    } = await makeProtocol({
      baseTokenBalance: tokenBalance,
    });

    expect(await USDC.balanceOf(alice.address)).to.be.equal(0);

    const tx = await wait(comet.connect(governor).withdrawReserves(alice.address, tokenBalance));

    expect(await USDC.balanceOf(alice.address)).to.equal(tokenBalance);
    expect(await USDC.balanceOf(comet.address)).to.equal(0);

    expect(event(tx, 0)).to.be.deep.equal({
      Transfer: {
        from: comet.address,
        to: alice.address,
        amount: tokenBalance,
      }
    });
    expect(event(tx, 1)).to.be.deep.equal({
      WithdrawReserves: {
        to: alice.address,
        amount: tokenBalance,
      }
    });
  });

  it('reverts if called not by governor', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();
    await expect(comet.connect(alice).withdrawReserves(alice.address, 10)).to.be.revertedWith(
      "custom error 'Unauthorized()'"
    );
  });

  it('reverts if not enough reserves are owned by protocol', async () => {
    const tokenBalance = 1000;
    const {
      comet,
      governor,
      users: [alice],
    } = await makeProtocol({
      baseTokenBalance: tokenBalance,
    });
    await expect(
      comet.connect(governor).withdrawReserves(alice.address, tokenBalance + 1)
    ).to.be.revertedWith("custom error 'InsufficientReserves()'");
  });

  it('accounts for total supply base when calculating reserves', async () => {
    const {
      comet,
      governor,
      users: [alice],
    } = await makeProtocol({
      baseTokenBalance: 200,
    });

    await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
      totalSupplyBase: 50n,
    });

    expect(await comet.getReserves()).to.be.equal(100);

    await expect(comet.connect(governor).withdrawReserves(alice.address, 101)).to.be.revertedWith(
      "custom error 'InsufficientReserves()'"
    );
  });

  it('reverts if negative reserves', async () => {
    const {
      comet,
      governor,
      users: [alice],
    } = await makeProtocol({
      baseTokenBalance: 0,
    });

    await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
      totalSupplyBase: 50n,
    });

    expect(await comet.getReserves()).to.be.equal(-100);

    await expect(comet.connect(governor).withdrawReserves(alice.address, 100)).to.be.revertedWith(
      "custom error 'InsufficientReserves()'"
    );
  });
});
