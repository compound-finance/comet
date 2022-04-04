import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario(
  'Comet#pause > governor pauses market actions',
  {
    pause: {
      all: false,
    },
  },
  async ({ comet, actors }) => {
    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;

    const { pauseGuardian } = actors;
    const txn = await pauseGuardian.pause({
      supplyPaused: true,
      transferPaused: true,
      withdrawPaused: true,
      absorbPaused: true,
      buyPaused: true,
    });

    expect(await comet.isSupplyPaused()).to.be.true;
    expect(await comet.isTransferPaused()).to.be.true;
    expect(await comet.isWithdrawPaused()).to.be.true;
    expect(await comet.isAbsorbPaused()).to.be.true;
    expect(await comet.isBuyPaused()).to.be.true;

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#pause > pause guardian pauses market actions',
  {
    pause: {
      all: false,
    },
  },
  async ({ comet, actors }) => {
    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;

    const { pauseGuardian } = actors;
    await pauseGuardian.pause({
      supplyPaused: true,
      transferPaused: true,
      withdrawPaused: true,
      absorbPaused: true,
      buyPaused: true,
    });

    expect(await comet.isSupplyPaused()).to.be.true;
    expect(await comet.isTransferPaused()).to.be.true;
    expect(await comet.isWithdrawPaused()).to.be.true;
    expect(await comet.isAbsorbPaused()).to.be.true;
    expect(await comet.isBuyPaused()).to.be.true;
  }
);

scenario(
  'Comet#pause > reverts if not called by governor or pause guardian',
  {
    pause: {
      all: false,
    },
    upgrade: true
  },
  async ({ comet, actors }) => {
    const { albert } = actors;
    await expect(
      albert.pause({
        supplyPaused: true,
        transferPaused: true,
        withdrawPaused: true,
        absorbPaused: true,
        buyPaused: true,
      })
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  }
);
