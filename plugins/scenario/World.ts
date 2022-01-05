import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Signer } from 'ethers';

export class World {
  hre: HardhatRuntimeEnvironment;

  constructor(hre) {
    this.hre = hre;
  }

  async _snapshot() {
    return this.hre.network.provider.request({
      method: 'evm_snapshot',
      params: [],
    });
  }

  async _revert(snapshot) {
    return this.hre.network.provider.request({
      method: 'evm_revert',
      params: [snapshot],
    });
  }

  async impersonateAddress(address: string): Promise<Signer> {
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
}
