import { BigNumberish, Contract, Signer } from 'ethers';
import { Token } from '../../build/types';

export default class CometAsset {
  token: Token;
  address: string;

  constructor(token: Token) {
    this.token = token;
    this.address = token.address;
  }

  async balanceOf(address: string): Promise<bigint> {
    return 0n; // XXX
  }
}
