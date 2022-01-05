import { Signer } from 'ethers';

export default class CometActor {
  signer: Signer;
  address: string;

  constructor(signer, address) {
    this.signer = signer;
    this.address = address;
  }

  async getEthBalance() {
    return this.signer.getBalance();
  }
}
