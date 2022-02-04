import { expect, makeProtocol, wait, filterEvent } from './helpers';

describe('withdrawReserves', function () {
  it('withdraws reserves from the protocol', async () => {
    const tokenBalance = 1000;
    const {
      comet,
      tokens: { USDC },
      users: [alice],
      governor,
    } = await makeProtocol({
      baseTokenBalance: tokenBalance,
    });

    expect(await USDC.balanceOf(alice.address)).to.be.equal(0);
    await comet.connect(governor).withdrawReserves(alice.address, tokenBalance);
    expect(await USDC.balanceOf(alice.address)).to.equal(tokenBalance);
  });

  it('emits `ReservesWthdrawn` event when reserves are withdrawn from the protocol', async () => {
    const tokenBalance = 1000;
    const {
      comet,
      governor,
      users: [alice],
    } = await makeProtocol({
      baseTokenBalance: tokenBalance,
    });

    const data = await wait(comet.connect(governor).withdrawReserves(alice.address, tokenBalance));
    const reservesWithdrawnEvent = filterEvent(data, 'ReservesWithdrawn');
    const [governorRes, to, amount] = reservesWithdrawnEvent.args;
    expect(governorRes).to.equal(governor.address);
    expect(to).to.equal(alice.address);
    expect(amount).to.equal(tokenBalance);
  });

  it('reverts if called not by governor', async () => {
    const {
      comet,
      users: [alice],
    } = await makeProtocol();
    await expect(comet.connect(alice).withdrawReserves(alice.address, 10)).to.be.revertedWith(
      'only governor may withdraw'
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
    ).to.be.revertedWith(
      'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
    );
  });
});
