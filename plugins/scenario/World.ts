import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Signer } from 'ethers';

export type ForkSpec = {
  name: string;
  url?: string;
  blockNumber?: number;
  allocation?: number;
  chainId?: number;
};

export class World {
  hre: HardhatRuntimeEnvironment;
  base: ForkSpec;

  constructor(hre, base: ForkSpec) {
    this.hre = hre;
    this.base = base;
  }

  // TODO: Can we do this better?
  isRemoteFork(): boolean {
    return !!this.base.url;
  }

  async _snapshot(): Promise<string> {
    return (await this.hre.network.provider.request({
      method: 'evm_snapshot',
      params: [],
    })) as string;
  }

  async _revert(snapshot: string) {
    return this.hre.network.provider.request({
      method: 'evm_revert',
      params: [snapshot],
    });
  }

  async _revertAndSnapshot(snapshot: string): Promise<string> {
    await this.hre.network.provider.request({
      method: 'evm_revert',
      params: [snapshot],
    });
    return await this._snapshot();
  }

  async impersonateAddress(address: string): Promise<SignerWithAddress> {
    await this.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [address],
    });
    return await this.hre.ethers.getSigner(address);
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
