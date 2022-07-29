import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { setNextBaseFeeToZero } from './utils';

scenario(
  'Comet#pause > governor pauses market actions',
  {
    pause: {
      all: false,
    },
  },
  async ({ comet, actors }, world, context) => {
    const { admin } = actors;

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;

    await setNextBaseFeeToZero(world);
    const txn = await admin.pause({
      supplyPaused: true,
      transferPaused: true,
      withdrawPaused: true,
      absorbPaused: true,
      buyPaused: true,
    }, { gasPrice: 0 });

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
  async ({ comet, actors }, world, context) => {
    const { pauseGuardian } = actors;

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;

    await setNextBaseFeeToZero(world);
    await pauseGuardian.pause({
      supplyPaused: true,
      transferPaused: true,
      withdrawPaused: true,
      absorbPaused: true,
      buyPaused: true,
    }, { gasPrice: 0 });

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
