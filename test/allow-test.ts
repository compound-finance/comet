import { Comet, ethers, expect, exp, makeProtocol, wait } from './helpers';

describe('allow', function () {
  it('isAllowed defaults to false', async () => {
    const { comet } = await makeProtocol();
    const [_admin, user, manager] = await ethers.getSigners();
    const userAddress = user.address;
    const managerAddress = manager.address;

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.false;
  });

  it('allows a user to authorize a manager', async () => {
    const { comet } = await makeProtocol();
    const [_admin, user, manager] = await ethers.getSigners();
    const userAddress = user.address;
    const managerAddress = manager.address;

    const tx = await comet.connect(user).allow(managerAddress, true);
    await tx.wait();

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.true;
  });

  it('allows a user to rescind authorization', async () => {
    const { comet } = await makeProtocol();
    const [_admin, user, manager] = await ethers.getSigners();
    const userAddress = user.address;
    const managerAddress = manager.address;

    const authorizeTx = await comet.connect(user).allow(managerAddress, true);
    await authorizeTx.wait();

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.true;

    const rescindTx = await comet.connect(user).allow(managerAddress, false);
    await rescindTx.wait();

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.false;
  });

  it('has permission only if the user is allowed or self', async () => {
    // XXX
  });
});
