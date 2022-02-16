import { ethers, expect, makeProtocol } from './helpers';

describe('allow', function () {
  it('isAllowed defaults to false', async () => {
    const { comet } = await makeProtocol();
    const [_admin, user, manager] = await ethers.getSigners();
    const userAddress = user.address;
    const managerAddress = manager.address;

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.false;
  });

  it('allows a user to authorize a manager', async () => {
    const { comet, cometExt } = await makeProtocol();
    const [_admin, user, manager] = await ethers.getSigners();
    const userAddress = user.address;
    const managerAddress = manager.address;

    const tx = await cometExt.connect(user).allow(managerAddress, true);
    await tx.wait();

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.true;
  });

  it('allows a user to rescind authorization', async () => {
    const { comet, cometExt } = await makeProtocol();
    const [_admin, user, manager] = await ethers.getSigners();
    const userAddress = user.address;
    const managerAddress = manager.address;

    const authorizeTx = await cometExt.connect(user).allow(managerAddress, true);
    await authorizeTx.wait();

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.true;

    const rescindTx = await cometExt.connect(user).allow(managerAddress, false);
    await rescindTx.wait();

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.false;
  });
});

describe('hasPermission', function () {
  it('is true for self', async () => {
    const { comet, users: [alice] } = await makeProtocol();
    expect(await comet.hasPermission(alice.address, alice.address)).to.be.true;
  });

  it('is false by default for others', async () => {
    const { comet, users: [alice, bob] } = await makeProtocol();
    expect(await comet.hasPermission(alice.address, bob.address)).to.be.false;
  });

  it('is true when user is allowed', async () => {
    const { comet, users: [alice, bob] } = await makeProtocol();
    await comet.connect(alice).allow(bob.address, true);
    expect(await comet.hasPermission(alice.address, bob.address)).to.be.true;
  });
});
