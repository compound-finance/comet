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

describe('allowThis', function () {
  it('isAllowed defaults to false', async () => {
    const { comet } = await makeProtocol();
    const [admin] = await ethers.getSigners();
    const adminAddress = admin.address;

    expect(await comet.isAllowed(comet.address, adminAddress)).to.be.false;
  });

  it('allows governor to authorize a manager', async () => {
    const { comet } = await makeProtocol();
    const [admin] = await ethers.getSigners();
    const adminAddress = admin.address;

    await comet.connect(admin).allowThis(adminAddress, true);

    expect(await comet.isAllowed(comet.address, adminAddress)).to.be.true;
  });

  it('allows governor to rescind authorization', async () => {
    const { comet } = await makeProtocol();
    const [admin, user] = await ethers.getSigners();
    const userAddress = user.address;

    await comet.connect(admin).allowThis(userAddress, true);

    expect(await comet.isAllowed(comet.address, userAddress)).to.be.true;

    comet.connect(admin).allowThis(userAddress, false);

    expect(await comet.isAllowed(comet.address, userAddress)).to.be.false;
  });

  it('reverts if not called by governor', async () => {
    const { comet } = await makeProtocol();
    const [ _admin, user ] = await ethers.getSigners();
    const userAddress = user.address;

    await expect(comet.connect(user).allowThis(userAddress, true))
      .to.be.revertedWith("custom error 'Unauthorized()'");
  });
});