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

  async withdrawReserves(to: CometActor, amount: number) {
    await (await this.cometContract.connect(this.signer).withdrawReserves(to.address, amount)).wait();
  }
}
