import { ethers, expect, makeProtocol, wait, filterEvent } from './helpers';

describe('withdrawReserves', function () {
  it('withdraws reserves from the protocol', async () => {
    const [governor, _pauseGuardian, user] = await ethers.getSigners();
    const tokenBalance = 1000;
    const baseTokenName = 'USDC';
    const params = {
      base: baseTokenName,
      baseTokenBalance: tokenBalance,
    };
    const { comet, tokens } = await makeProtocol(params);
    const baseToken = tokens[baseTokenName];

    expect(await baseToken.balanceOf(user.address)).to.be.equal(0);
    await wait(comet.connect(governor).withdrawReserves(user.address, tokenBalance));
    expect(await baseToken.balanceOf(user.address)).to.be.equal(tokenBalance);
  });

  it('emits `ReservesWthdrawn` event when reserves are withdrawn from the protocol', async () => {
    const [governor, _pauseGuardian, user] = await ethers.getSigners();
    const tokenBalance = 1000;
    const baseTokenName = 'USDC';
    const params = {
      base: baseTokenName,
      baseTokenBalance: tokenBalance,
    };
    const { comet } = await makeProtocol(params);

    const data = await wait(comet.connect(governor).withdrawReserves(user.address, tokenBalance));
    const reservesWithdrawnEvent = filterEvent(data, 'ReservesWithdrawn');
    const [governorRes, to, amount] = reservesWithdrawnEvent.args;
    expect(governorRes).to.equal(governor.address);
    expect(to).to.equal(user.address);
    expect(amount).to.equal(tokenBalance);
  });

  it('reverts if called not by governor', async () => {
    const [_governor, _pauseGuardian, user] = await ethers.getSigners();
    const { comet } = await makeProtocol();
    await expect(comet.connect(user).withdrawReserves(user.address, 10)).to.be.revertedWith(
      'Unauthorized'
    );
  });

  it('reverts if not enough reserves are owned by protocol', async () => {
    const [governor, _pauseGuardian, user] = await ethers.getSigners();
    const tokenBalance = 1000;
    const { comet } = await makeProtocol({ baseTokenBalance: tokenBalance });
    await expect(
      comet.connect(governor).withdrawReserves(user.address, tokenBalance + 1)
    ).to.be.revertedWith(
      'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
    );
  });
});
