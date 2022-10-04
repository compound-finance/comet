import { DeploymentManager } from '../../plugins/deployment_manager';

export async function setNextBaseFeeToZero(dm: DeploymentManager) {
  await dm.hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
}

export async function mineBlocks(dm: DeploymentManager, blocks: number) {
  await dm.hre.network.provider.send('hardhat_mine', [`0x${blocks.toString(16)}`]);
}

export async function setNextBlockTimestamp(dm: DeploymentManager, timestamp: number) {
  await dm.hre.ethers.provider.send('evm_setNextBlockTimestamp', [timestamp]);
}