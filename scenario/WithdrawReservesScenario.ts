import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';

// XXX we could use a Comet reserves constraint here
scenario(
  'Comet#withdrawReserves > governor withdraw reserves',
  {
    tokenBalances: {
      betty: { $base: '== 100000' },
      albert: { $base: '== 0' },
    },
    upgrade: true,
  },
  async ({ comet, timelock, actors }, world, context) => {
    const { albert, betty } = actors;

    const baseToken = context.getAssetByAddress(await comet.baseToken());
    const scale = (await comet.baseScale()).toBigInt();

    // Since we don't have a constraint to set Comet reserves, we'll be transferring 100K base tokens to Comet from an actor
    // XXX however, this wouldn't work if reserves on testnet are too negative
    await betty.transferErc20(baseToken.address, comet.address, 100000n * scale);
    const cometBaseBalance = await baseToken.balanceOf(comet.address);

    expect(await comet.governor()).to.equal(timelock.address);

    const toWithdrawAmount = 10n * scale;
    let withdrawReservesCalldata = utils.defaultAbiCoder.encode(["address", "uint256"], [albert.address, toWithdrawAmount]);
    const txn = await context.fastGovernanceExecute(
      [comet.address],
      [0],
      ["withdrawReserves(address,uint256)"],
      [withdrawReservesCalldata]
    );

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
    upgrade: true,
  },
  async ({ actors }) => {
    const { albert } = actors;
    await expect(albert.withdrawReserves(albert, 10)).to.be.revertedWith(
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
    upgrade: true,
  },
  async ({ comet, actors }, world, context) => {
    const { admin, albert } = actors;

    const scale = (await comet.baseScale()).toBigInt();

    let withdrawReservesCalldata = utils.defaultAbiCoder.encode(["address", "uint256"], [albert.address, 101n * scale]);
    // Note: Should be `InsufficientReserves()` error, but that error is masked by the Timelock error
    await expect(context.fastGovernanceExecute(
      [comet.address],
      [0],
      ["withdrawReserves(address,uint256)"],
      [withdrawReservesCalldata]
    )).to.be.revertedWith('Timelock::executeTransaction: Transaction execution reverted.');
  }
);

// XXX add scenario that tests for a revert when reserves are reduced by
// totalSupplyBase
