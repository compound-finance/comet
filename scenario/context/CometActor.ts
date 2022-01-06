import { Signer } from 'ethers';
import { Comet } from '../../build/types';

export default class CometActor {
  signer: Signer;
  address: string;
  cometContract: Comet;

  constructor(signer: Signer, address: string, cometContract: Comet) {
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
  
  async pause(
    supplyPaused: boolean,
    transferPaused: boolean,
    withdrawPaused: boolean,
    absorbPaused: boolean,
    buyPaused: boolean
  ) {
    await (
      await this.cometContract
        .connect(this.signer)
        .pause(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused)
    ).wait();
  }

  async isSupplyPaused(): Promise<boolean> {
    return await this.cometContract.connect(this.signer).isSupplyPaused();
  }

  async isTransferPaused(): Promise<boolean> {
    return await this.cometContract.connect(this.signer).isTransferPaused();
  }

  async isWithdrawPaused(): Promise<boolean> {
    return await this.cometContract.connect(this.signer).isWithdrawPaused();
  }

  async isAbsorbPaused(): Promise<boolean> {
    return await this.cometContract.connect(this.signer).isAbsorbPaused();
  }

  async isBuyPaused(): Promise<boolean> {
    return await this.cometContract.connect(this.signer).isBuyPaused();
  }
}
