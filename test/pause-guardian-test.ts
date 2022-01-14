import { Comet, ethers, expect, exp, makeProtocol, wait } from './helpers';

describe('Pause Guardian', function () {
  it('Should pause supply', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    await comet.pause(true, false, false, false, false);

    expect(await comet.isSupplyPaused()).to.be.true;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause transfer', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    await comet.pause(false, true, false, false, false);

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.true;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause withdraw', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    await comet.pause(false, false, true, false, false);

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.true;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause absorb', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    await comet.pause(false, false, false, true, false);

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.true;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause buy', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    await comet.pause(false, false, false, false, true);

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.true;
  });

  it('Should unpause', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    await comet.pause(true, true, true, true, true);

    await assertAllActionsArePaused(comet);

    await comet.pause(false, false, false, false, false);

    await assertNoActionsArePaused(comet);
  });

  it('Should pause when called by governor', async function () {
    const { comet, governor } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    await comet.connect(governor).pause(true, true, true, true, true);

    await assertAllActionsArePaused(comet);
  });

  it('Should pause when called by pause guardian', async function () {
    const { comet, pauseGuardian } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    await comet.connect(pauseGuardian).pause(true, true, true, true, true);

    await assertAllActionsArePaused(comet);
  });

  it('Should revert if not called by governor or pause guardian', async function () {
    const { comet, users } = await makeProtocol();
    await expect(comet.connect(users[0]).pause(true, true, true, true, true)).to.be.revertedWith(
      'Unauthorized'
    );
  });
});

async function assertNoActionsArePaused(comet: Comet) {
  // All pause flags should be false by default.
  expect(await comet.isSupplyPaused()).to.be.false;
  expect(await comet.isTransferPaused()).to.be.false;
  expect(await comet.isWithdrawPaused()).to.be.false;
  expect(await comet.isAbsorbPaused()).to.be.false;
  expect(await comet.isBuyPaused()).to.be.false;
}

async function assertAllActionsArePaused(comet: Comet) {
  expect(await comet.isSupplyPaused()).to.be.true;
  expect(await comet.isTransferPaused()).to.be.true;
  expect(await comet.isWithdrawPaused()).to.be.true;
  expect(await comet.isAbsorbPaused()).to.be.true;
  expect(await comet.isBuyPaused()).to.be.true;
}
