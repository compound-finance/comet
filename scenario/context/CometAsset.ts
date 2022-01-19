import { BigNumberish, Contract, Signer } from 'ethers';
import { ERC20 } from '../../build/types';

export default class CometAsset {
  token: ERC20;
  address: string;

  constructor(token: ERC20) {
    this.token = token;
    this.address = token.address;
  }

  async balanceOf(address: string): Promise<bigint> {
    return 0n; // XXX
  }
}
