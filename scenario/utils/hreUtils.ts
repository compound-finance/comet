import { DeploymentManager } from '../../plugins/deployment_manager';

export async function setNextBaseFeeToZero(dm: DeploymentManager) {
  await dm.hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
}

export async function mineBlocks(dm: DeploymentManager, blocks: number) {
  const hex = `0x${blocks.toString(16)}`;

  if (dm.tenderly) {
    await dm.hre.network.provider.send('evm_increaseBlocks', [hex]);
  } else {
    await dm.hre.network.provider.send('hardhat_mine', [hex]);
  }
}

export async function setNextBlockTimestamp(dm: DeploymentManager, timestamp: number) {
  await dm.hre.ethers.provider.send('evm_setNextBlockTimestamp', [timestamp]);
}