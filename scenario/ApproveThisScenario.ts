import { scenario } from './context/CometContext';
import { expectRevertCustom } from './utils';
import { expect } from 'chai';
import { constants } from 'ethers';

scenario('Comet#approveThis > allows governor to authorize and rescind authorization for Comet ERC20', {}, async ({ comet, timelock, actors }, context) => {
  const { admin } = actors;

  await context.setNextBaseFeeToZero();
  await admin.approveThis(timelock.address, comet.address, constants.MaxUint256, { gasPrice: 0 });

  expect(await comet.isAllowed(comet.address, timelock.address)).to.be.true;

  await context.setNextBaseFeeToZero();
  await admin.approveThis(timelock.address, comet.address, 0, { gasPrice: 0 });

  expect(await comet.isAllowed(comet.address, timelock.address)).to.be.false;
});

scenario('Comet#approveThis > allows governor to authorize and rescind authorization for non-Comet ERC20', {}, async ({ comet, timelock, actors }, context) => {
  const { admin } = actors;
  const baseTokenAddress = await comet.baseToken();
  const baseToken = context.getAssetByAddress(baseTokenAddress);

  const newAllowance = 999_888n;
  await context.setNextBaseFeeToZero();
  await admin.approveThis(timelock.address, baseTokenAddress, newAllowance, { gasPrice: 0 });

  expect(await baseToken.allowance(comet.address, timelock.address)).to.be.equal(newAllowance);

  await context.setNextBaseFeeToZero();
  await admin.approveThis(timelock.address, baseTokenAddress, 0, { gasPrice: 0 });

  expect(await baseToken.allowance(comet.address, timelock.address)).to.be.equal(0n);
});

scenario('Comet#approveThis > reverts if not called by governor', {}, async ({ comet, timelock }) => {
  await expectRevertCustom(comet.approveThis(timelock.address, comet.address, constants.MaxUint256), 'Unauthorized()');
});
