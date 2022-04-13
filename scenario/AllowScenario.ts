import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';

scenario('Comet#allow > allows a user to authorize a manager', { upgrade: true }, async ({ comet, actors }) => {
  const { albert, betty } = actors;

  const txn = await albert.allow(betty, true);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;

  return txn; // return txn to measure gas
});

scenario('Comet#allow > allows a user to rescind authorization', {}, async ({ comet, actors }) => {
  const { albert, betty } = actors;

  await albert.allow(betty, true);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;

  await albert.allow(betty, false);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;
});

scenario('Comet#allowThis > allows governor to authorize and rescind authorization', { upgrade: true }, async ({ comet, timelock, actors }, world, context) => {
  let allowThisCalldata = utils.defaultAbiCoder.encode(["address", "bool"], [timelock.address, true]);
  await context.fastGovernanceExecute(
    [comet.address],
    [0],
    ["allowThis(address,bool)"],
    [allowThisCalldata]
  );

  expect(await comet.isAllowed(comet.address, timelock.address)).to.be.true;

  allowThisCalldata = utils.defaultAbiCoder.encode(["address", "bool"], [timelock.address, false]);
  await context.fastGovernanceExecute(
    [comet.address],
    [0],
    ["allowThis(address,bool)"],
    [allowThisCalldata]
  );

  expect(await comet.isAllowed(comet.address, timelock.address)).to.be.false;
});

scenario('Comet#allowThis > reverts if not called by governor', { upgrade: true }, async ({ comet,timelock, actors }) => {
  await expect(comet.allowThis(timelock.address, true))
    .to.be.revertedWith("custom error 'Unauthorized()'");
});
