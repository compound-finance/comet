import { DeploymentManager } from '../../plugins/deployment_manager';
import { World } from '../../plugins/scenario';
import CometActor from '../context/CometActor';

export async function setNextBaseFeeToZero(dm: DeploymentManager) {
  await dm.hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
}

export async function mineBlocks(dm: DeploymentManager, blocks: number) {
  const hex = `0x${blocks.toString(16)}`;

  await dm.hre.network.provider.send('hardhat_mine', [hex]);
}

export async function setNextBlockTimestamp(dm: DeploymentManager, timestamp: number) {
  await dm.hre.ethers.provider.send('evm_setNextBlockTimestamp', [timestamp]);
}

export async function fundAccount(world: World, account: CometActor) {
  await world.deploymentManager.hre.network.provider.send('hardhat_setBalance', [
    account.address,
    world.deploymentManager.hre.ethers.utils.hexStripZeros(world.deploymentManager.hre.ethers.utils.parseEther('100').toHexString()),
  ]);
}