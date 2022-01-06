import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario('Comet#pause > governor pauses market actions', {}, async ({ comet, actors }) => {
  expect(await comet.isSupplyPaused()).to.be.false;
  expect(await comet.isTransferPaused()).to.be.false;
  expect(await comet.isWithdrawPaused()).to.be.false;
  expect(await comet.isAbsorbPaused()).to.be.false;
  expect(await comet.isBuyPaused()).to.be.false;

  const { admin } = actors;
  await admin.pause(true, true, true, true, true);

  expect(await comet.isSupplyPaused()).to.be.true;
  expect(await comet.isTransferPaused()).to.be.true;
  expect(await comet.isWithdrawPaused()).to.be.true;
  expect(await comet.isAbsorbPaused()).to.be.true;
  expect(await comet.isBuyPaused()).to.be.true;
});

scenario('Comet#pause > pause guardian pauses market actions', {}, async ({ comet, actors }) => {
  expect(await comet.isSupplyPaused()).to.be.false;
  expect(await comet.isTransferPaused()).to.be.false;
  expect(await comet.isWithdrawPaused()).to.be.false;
  expect(await comet.isAbsorbPaused()).to.be.false;
  expect(await comet.isBuyPaused()).to.be.false;

  const { pauseGuardian } = actors;
  await pauseGuardian.pause(true, true, true, true, true);

  expect(await comet.isSupplyPaused()).to.be.true;
  expect(await comet.isTransferPaused()).to.be.true;
  expect(await comet.isWithdrawPaused()).to.be.true;
  expect(await comet.isAbsorbPaused()).to.be.true;
  expect(await comet.isBuyPaused()).to.be.true;
});

scenario(
  'Comet#pause > reverts if not called by governor or pause guardian',
  {},
  async ({ comet, actors }) => {
    const { albert } = actors;
    await expect(albert.pause(true, true, true, true, true)).to.be.revertedWith('Unauthorized');
  }
);
