import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumberish, Signer } from 'ethers';
import { Comet } from '../../build/types';

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
  cometContract: Comet;

  constructor(signer: SignerWithAddress, address: string, cometContract: Comet) {
    this.signer = signer;
    this.address = address;
    this.cometContract = cometContract;
  }

  async getEthBalance() {
    return this.signer.getBalance();
  }

  async allow(manager: CometActor, isAllowed: boolean) {
    await (await this.cometContract.connect(this.signer).allow(manager.address, isAllowed)).wait();
  }

  async pause({
    supplyPaused = false,
    transferPaused = false,
    withdrawPaused = false,
    absorbPaused = false,
    buyPaused = false,
  }) {
    await (
      await this.cometContract
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
      name: await this.cometContract.NAME(),
      version: await this.cometContract.VERSION(),
      chainId: chainId,
      verifyingContract: this.cometContract.address,
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
    await this.cometContract
      .connect(this.signer)
      .allowBySig(this.address, isAllowed, nonce, expiry, signature);
  }
}