import { Comet, expect, event, makeProtocol, wait } from './helpers';

describe('Pause Guardian', function () {
  it('Should pause supply', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    const txn = await wait(comet.pause(true, false, false, false, false));

    expect(await comet.isSupplyPaused()).to.be.true;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
    expect(event(txn, 0)).to.be.deep.equal({
      PauseAction: {
        supplyPaused: true,
        transferPaused: false,
        withdrawPaused: false,
        absorbPaused: false,
        buyPaused: false,
      }
    });
  });

  it('Should pause transfer', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    const txn = await wait(comet.pause(false, true, false, false, false));

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.true;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
    expect(event(txn, 0)).to.be.deep.equal({
      PauseAction: {
        supplyPaused: false,
        transferPaused: true,
        withdrawPaused: false,
        absorbPaused: false,
        buyPaused: false,
      }
    });
  });

  it('Should pause withdraw', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    const txn = await wait(comet.pause(false, false, true, false, false));

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.true;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
    expect(event(txn, 0)).to.be.deep.equal({
      PauseAction: {
        supplyPaused: false,
        transferPaused: false,
        withdrawPaused: true,
        absorbPaused: false,
        buyPaused: false,
      }
    });
  });

  it('Should pause absorb', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    const txn = await wait(comet.pause(false, false, false, true, false));

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.true;
    expect(await comet.isBuyPaused()).to.be.false;
    expect(event(txn, 0)).to.be.deep.equal({
      PauseAction: {
        supplyPaused: false,
        transferPaused: false,
        withdrawPaused: false,
        absorbPaused: true,
        buyPaused: false,
      }
    });
  });

  it('Should pause buy', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    const txn = await wait(comet.pause(false, false, false, false, true));

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.true;
    expect(event(txn, 0)).to.be.deep.equal({
      PauseAction: {
        supplyPaused: false,
        transferPaused: false,
        withdrawPaused: false,
        absorbPaused: false,
        buyPaused: true,
      }
    });
  });

  it('Should unpause', async function () {
    const { comet } = await makeProtocol();
    await assertNoActionsArePaused(comet);

    const txn1 = await wait(comet.pause(true, true, true, true, true));

    await assertAllActionsArePaused(comet);

    const txn2 = await wait(comet.pause(false, false, false, false, false));

    await assertNoActionsArePaused(comet);
    expect(event(txn1, 0)).to.be.deep.equal({
      PauseAction: {
        supplyPaused: true,
        transferPaused: true,
        withdrawPaused: true,
        absorbPaused: true,
        buyPaused: true,
      }
    });
    expect(event(txn2, 0)).to.be.deep.equal({
      PauseAction: {
        supplyPaused: false,
        transferPaused: false,
        withdrawPaused: false,
        absorbPaused: false,
        buyPaused: false,
      }
    });
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
    await expect(
      comet.connect(users[0]).pause(true, true, true, true, true)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
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
