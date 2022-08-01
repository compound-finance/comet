import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { setNextBaseFeeToZero } from './utils';

// XXX we could use a Comet reserves constraint here
scenario(
  'Comet#withdrawReserves > governor withdraw reserves',
  {
    tokenBalances: {
      betty: { $base: '== 100000' },
      albert: { $base: '== 0' },
    },
  },
  async ({ comet, timelock, actors }, world, context) => {
    const { admin, albert, betty } = actors;

    const baseToken = context.getAssetByAddress(await comet.baseToken());
    const scale = (await comet.baseScale()).toBigInt();

    // Since we don't have a constraint to set Comet reserves, we'll be transferring 100K base tokens to Comet from an actor
    // XXX however, this wouldn't work if reserves on testnet are too negative
    await betty.transferErc20(baseToken.address, comet.address, 100000n * scale);
    const cometBaseBalance = await baseToken.balanceOf(comet.address);

    expect(await comet.governor()).to.equal(timelock.address);

    const toWithdrawAmount = 10n * scale;
    await setNextBaseFeeToZero(world);
    const txn = await admin.withdrawReserves(albert.address, toWithdrawAmount, { gasPrice: 0 });

    expect(await baseToken.balanceOf(comet.address)).to.equal(cometBaseBalance - toWithdrawAmount);
    expect(await baseToken.balanceOf(albert.address)).to.equal(toWithdrawAmount);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawReserves > reverts if not called by governor',
  {
    tokenBalances: {
      $comet: { $base: 100 },
    },
  },
  async ({ actors }) => {
    const { albert } = actors;
    await expect(albert.withdrawReserves(albert.address, 10)).to.be.revertedWith(
      "custom error 'Unauthorized()'"
    );
  }
);

scenario(
  'Comet#withdrawReserves > reverts if not enough reserves are owned by protocol',
  {
    tokenBalances: {
      $comet: { $base: 100 },
    },
  },
  async ({ comet, actors }, world, context) => {
    const { admin, albert } = actors;

    const scale = (await comet.baseScale()).toBigInt();

    await setNextBaseFeeToZero(world);
    await expect(admin.withdrawReserves(albert.address, 101n * scale, { gasPrice: 0 }))
      .to.be.revertedWith("custom error 'InsufficientReserves()'");
  }
);

// XXX add scenario that tests for a revert when reserves are reduced by
// totalSupplyBase
