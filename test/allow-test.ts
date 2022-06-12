import { ethers, event, expect, makeProtocol, wait } from './helpers';

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

    const tx = await wait(comet.connect(user).allow(managerAddress, true));

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.true;
    expect(event(tx, 0)).to.be.deep.equal({
      Approval: {
        owner: userAddress,
        spender: managerAddress,
        amount: ethers.constants.MaxUint256.toBigInt(),
      }
    });
  });

  it('allows a user to rescind authorization', async () => {
    const { comet } = await makeProtocol();
    const [_admin, user, manager] = await ethers.getSigners();
    const userAddress = user.address;
    const managerAddress = manager.address;

    const _authorizeTx = await wait(comet.connect(user).allow(managerAddress, true));

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.true;

    const rescindTx = await wait(comet.connect(user).allow(managerAddress, false));

    expect(await comet.isAllowed(userAddress, managerAddress)).to.be.false;
    expect(event(rescindTx, 0)).to.be.deep.equal({
      Approval: {
        owner: userAddress,
        spender: managerAddress,
        amount: 0n,
      }
    });
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
