import { BigNumberish, Contract, Signer } from 'ethers';

export default class CometAsset {
  // XXX how are we hooking these up w/ names etc to deployment manager contracts?
  // XXX does this abstract over erc20 and eth?
  async getAddress(): Promise<string> {
    return '0xxxx'; // XXX
  }

  async balanceOf(address: string): Promise<bigint> {
    return 0n; // XXX
  }
}
