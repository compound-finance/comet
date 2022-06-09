import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { constants, utils } from 'ethers';

scenario('Comet#approveThis > allows governor to authorize and rescind authorization for Comet ERC20', { upgrade: true }, async ({ comet, timelock, actors }, world, context) => {
  let approveThisCalldata = utils.defaultAbiCoder.encode(["address", "address", "uint256"], [timelock.address, comet.address, constants.MaxUint256]);
  await context.fastGovernanceExecute(
    [comet.address],
    [0],
    ["approveThis(address,address,uint256)"],
    [approveThisCalldata]
  );

  expect(await comet.isAllowed(comet.address, timelock.address)).to.be.true;

  approveThisCalldata = utils.defaultAbiCoder.encode(["address", "address", "uint256"], [timelock.address, comet.address, constants.Zero]);
  await context.fastGovernanceExecute(
    [comet.address],
    [0],
    ["approveThis(address,address,uint256)"],
    [approveThisCalldata]
  );

  expect(await comet.isAllowed(comet.address, timelock.address)).to.be.false;
});

scenario('Comet#approveThis > allows governor to authorize and rescind authorization for non-Comet ERC20', { upgrade: true }, async ({ comet, timelock, actors }, world, context) => {
  const baseTokenAddress = await comet.baseToken();
  const baseToken = context.getAssetByAddress(baseTokenAddress);

  const newAllowance = 999_888n;
  let approveThisCalldata = utils.defaultAbiCoder.encode(["address", "address", "uint256"], [timelock.address, baseTokenAddress, newAllowance]);
  await context.fastGovernanceExecute(
    [comet.address],
    [0],
    ["approveThis(address,address,uint256)"],
    [approveThisCalldata]
  );

  expect(await baseToken.allowance(comet.address, timelock.address)).to.be.equal(newAllowance);

  approveThisCalldata = utils.defaultAbiCoder.encode(["address", "address", "uint256"], [timelock.address, baseTokenAddress, 0n]);
  await context.fastGovernanceExecute(
    [comet.address],
    [0],
    ["approveThis(address,address,uint256)"],
    [approveThisCalldata]
  );

  expect(await baseToken.allowance(comet.address, timelock.address)).to.be.equal(0n);
});

scenario('Comet#approveThis > reverts if not called by governor', { upgrade: true }, async ({ comet, timelock, actors }) => {
  await expect(comet.approveThis(timelock.address, comet.address, constants.MaxUint256))
    .to.be.revertedWith("custom error 'Unauthorized()'");
});
