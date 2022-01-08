import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumberish, Signer } from 'ethers';
import { Comet } from '../../build/types';
import { CometContext } from './CometContext';

const types = {
  Authorization: [
    { name: 'manager', type: 'address' },
    { name: '_isAllowed', type: 'bool' },
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
    managerAddress,
    isAllowed,
    nonce,
    expiry,
    chainId,
  }: {
    managerAddress: string;
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
      manager: managerAddress,
      _isAllowed: isAllowed,
      nonce,
      expiry,
    };
    return await this.signer._signTypedData(domain, types, value);
  }

  async allowBySig({
    isAllowed,
    nonce,
    expiry,
    signature,
  }: {
    isAllowed: boolean;
    nonce: BigNumberish;
    expiry: number;
    signature: string;
  }) {
    await this.context.comet
      .connect(this.signer)
      .allowBySig(this.address, isAllowed, nonce, expiry, signature);
  }
}