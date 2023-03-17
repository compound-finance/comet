import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

// NB: this couples this plugin to deployment manager plugin
import { DeploymentManager } from '../deployment_manager/DeploymentManager';
import hreForBase from './utils/hreForBase';
import { impersonateAddress } from './utils';

export type ForkSpec = {
  name: string;
  network: string;
  deployment: string;
  blockNumber?: number;
  allocation?: number;
  auxiliaryBase?: string;
};

export type Snapshot = {
  snapshot: string;
  auxiliarySnapshot?: string;
}

export class World {
  base: ForkSpec;
  deploymentManager: DeploymentManager;
  snapshotDeploymentManager: DeploymentManager;

  auxiliaryDeploymentManager?: DeploymentManager;
  snapshotAuxiliaryDeploymentManager?: DeploymentManager;

  constructor(base: ForkSpec) {
    // Q: should we really need to fork/snapshot the deployment manager?
    const hre = hreForBase(base);
    this.base = base;
    this.deploymentManager = new DeploymentManager(base.network, base.deployment, hre);
    this.snapshotDeploymentManager = this.deploymentManager;

    if (this.base.auxiliaryBase) {
      const auxiliaryBase = hre.config.scenario.bases.find(b => b.name === this.base.auxiliaryBase);
      this.auxiliaryDeploymentManager = new DeploymentManager(auxiliaryBase.network, auxiliaryBase.deployment, hreForBase(auxiliaryBase));
      this.snapshotAuxiliaryDeploymentManager = this.auxiliaryDeploymentManager;
    }
  }

  isRemoteFork(): boolean {
    return this.base.network !== 'hardhat';
  }

  async _snapshot(): Promise<Snapshot> {
    this.snapshotDeploymentManager = this.deploymentManager.fork();
    const snapshot = await this.deploymentManager.hre.network.provider.request({
      method: 'evm_snapshot',
      params: [],
    }) as string;
    let auxiliarySnapshot: string;
    if (this.auxiliaryDeploymentManager) {
      this.snapshotAuxiliaryDeploymentManager = this.auxiliaryDeploymentManager.fork();
      auxiliarySnapshot = await this.auxiliaryDeploymentManager.hre.network.provider.request({
        method: 'evm_snapshot',
        params: [],
      }) as string;
    }
    return { snapshot, auxiliarySnapshot };
  }

  async _revert(snapshot: Snapshot) {
    this.deploymentManager = this.snapshotDeploymentManager;
    await this.deploymentManager.hre.network.provider.request({
      method: 'evm_revert',
      params: [snapshot.snapshot],
    });

    if (this.auxiliaryDeploymentManager) {
      this.auxiliaryDeploymentManager = this.snapshotAuxiliaryDeploymentManager;
      await this.auxiliaryDeploymentManager.hre.network.provider.request({
        method: 'evm_revert',
        params: [snapshot.auxiliarySnapshot],
      });
    }
  }

  async _revertAndSnapshot(snapshot: Snapshot): Promise<Snapshot> {
    await this._revert(snapshot);
    return await this._snapshot();
  }

  async impersonateAddress(address: string, opts?: { value?: bigint, onGovNetwork?: boolean }): Promise<SignerWithAddress> {
    const options = opts ?? {};
    const dm = options.onGovNetwork ? this.auxiliaryDeploymentManager ?? this.deploymentManager : this.deploymentManager;
    return await impersonateAddress(dm, address, options.value);
  }

  async timestamp() {
    const blockNumber = await this.deploymentManager.hre.ethers.provider.getBlockNumber();
    return (await this.deploymentManager.hre.ethers.provider.getBlock(blockNumber)).timestamp;
  }

  async increaseTime(amount: number) {
    await this.deploymentManager.hre.network.provider.send('evm_increaseTime', [amount]);
    await this.deploymentManager.hre.network.provider.send('evm_mine'); // ensure block is mined
  }

  async chainId() {
    return (await this.deploymentManager.hre.ethers.provider.getNetwork()).chainId;
  }
}
