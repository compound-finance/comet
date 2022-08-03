import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

// NB: this couples this plugin to deployment manager plugin
import { DeploymentManager } from '../deployment_manager/DeploymentManager';

export type ForkSpec = {
  name: string;
  network: string;
  deployment: string;
  blockNumber?: number;
  allocation?: number;
};

export class World {
  hre: HardhatRuntimeEnvironment;
  base: ForkSpec;
  deploymentManager: DeploymentManager;
  snapshotDeploymentManager: DeploymentManager;

  constructor(hre, base: ForkSpec) {
    // Q: should we really need to fork/snapshot the deployment manager?
    this.hre = hre;
    this.base = base;
    this.deploymentManager = new DeploymentManager(base.network, base.deployment, hre, { debug: true });
    this.snapshotDeploymentManager = this.deploymentManager;
  }

  // TODO: Can we do this better?
  isRemoteFork(): boolean {
    return this.base.network !== 'hardhat';
  }

  async _snapshot(): Promise<string> {
    this.snapshotDeploymentManager = this.deploymentManager.fork();
    return (await this.hre.network.provider.request({
      method: 'evm_snapshot',
      params: [],
    })) as string;
  }

  async _revert(snapshot: string) {
    this.deploymentManager = this.snapshotDeploymentManager;
    return this.hre.network.provider.request({
      method: 'evm_revert',
      params: [snapshot],
    });
  }

  async _revertAndSnapshot(snapshot: string): Promise<string> {
    await this._revert(snapshot);
    return await this._snapshot();
  }

  async impersonateAddress(address: string): Promise<SignerWithAddress> {
    await this.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [address],
    });
    return await this.deploymentManager.getSigner(address);
  }

  async timestamp() {
    const blockNumber = await this.hre.ethers.provider.getBlockNumber();
    return (await this.hre.ethers.provider.getBlock(blockNumber)).timestamp;
  }

  async increaseTime(amount: number) {
    await this.hre.network.provider.send('evm_increaseTime', [amount]);
    await this.hre.network.provider.send('evm_mine'); // ensure block is mined
  }

  async chainId() {
    return (await this.hre.ethers.provider.getNetwork()).chainId;
  }
}
