import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumberish, Signature, ethers } from 'ethers';
import { CometContext } from './CometContext';

const types = {
  Authorization: [
    { name: 'owner', type: 'address' },
    { name: 'manager', type: 'address' },
    { name: 'isAllowed', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
};

export default class CometActor {
  signer: SignerWithAddress;
  address: string;
  context: CometContext;

  constructor(signer: SignerWithAddress, address: string, context: CometContext) {
    this.signer = signer;
    this.address = address;
    this.context = context;
  }

  async getEthBalance() {
    return this.signer.getBalance();
  }

  async allow(manager: CometActor, isAllowed: boolean) {
    await (await this.context.comet.connect(this.signer).allow(manager.address, isAllowed)).wait();
  }

  async pause({
    supplyPaused = false,
    transferPaused = false,
    withdrawPaused = false,
    absorbPaused = false,
    buyPaused = false,
  }) {
    await (
      await this.context.comet
        .connect(this.signer)
        .pause(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused)
    ).wait();
  }

  async signAuthorization({
    manager,
    isAllowed,
    nonce,
    expiry,
    chainId,
  }: {
    manager: string;
    isAllowed: boolean;
    nonce: BigNumberish;
    expiry: number;
    chainId: number;
  }) {
    const domain = {
      name: await this.context.comet.NAME(),
      version: await this.context.comet.VERSION(),
      chainId: chainId,
      verifyingContract: this.context.comet.address,
    };
    const value = {
      owner: this.address,
      manager,
      isAllowed,
      nonce,
      expiry,
    };
    const rawSignature = await this.signer._signTypedData(domain, types, value);
    return ethers.utils.splitSignature(rawSignature);
  }

  async allowBySig({
    owner,
    manager,
    isAllowed,
    nonce,
    expiry,
    signature,
  }: {
    owner: string;
    manager: string;
    isAllowed: boolean;
    nonce: BigNumberish;
    expiry: number;
    signature: Signature;
  }) {
    await this.context.comet
      .connect(this.signer)
      .allowBySig(owner, manager, isAllowed, nonce, expiry, signature.v, signature.r, signature.s);
  }
}
