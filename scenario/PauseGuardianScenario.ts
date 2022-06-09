import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';

scenario(
  'Comet#pause > governor pauses market actions',
  {
    pause: {
      all: false,
    },
  },
  async ({ comet, actors }, _world, context) => {
    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;

    const pauseCalldata = utils.defaultAbiCoder.encode(
      ["bool", "bool", "bool", "bool", "bool"],
      [true, true, true, true, true]
    );
    const txn = await context.fastGovernanceExecute(
      [comet.address],
      [0],
      ["pause(bool,bool,bool,bool,bool)"],
      [pauseCalldata]
    );

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
  async ({ comet, actors }, _world, context) => {
    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;

    const pauseCalldata = utils.defaultAbiCoder.encode(
      ["bool", "bool", "bool", "bool", "bool"],
      [true, true, true, true, true]
    );
    await context.fastGovernanceExecute(
      [comet.address],
      [0],
      ["pause(bool,bool,bool,bool,bool)"],
      [pauseCalldata]
    );

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
