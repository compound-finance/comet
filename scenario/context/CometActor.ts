import { BigNumberish, Contract, Signer } from 'ethers';
import {
  AsteroidRaffle__factory,
  AsteroidRaffle,
  FaucetToken__factory,
  FaucetToken,
  MockedOracle__factory,
} from '../../build/types';

export default class CometActor {
  signer: Signer;
  address: string;
  raffleContract: AsteroidRaffle;
  tokenContract: FaucetToken;

  constructor(signer, address, raffleContract, tokenContract) {
    this.signer = signer;
    this.address = address;
    this.raffleContract = raffleContract;
    this.tokenContract = tokenContract;
  }

  async enterWithEth(ticketPrice: number) {
    (await this.raffleContract.connect(this.signer).enterWithEth({ value: ticketPrice })).wait();
  }

  async enterWithToken(ticketPrice: number) {
    (await this.tokenContract.allocateTo(await this.signer.getAddress(), ticketPrice)).wait();
    (
      await this.tokenContract
        .connect(this.signer)
        .approve(this.raffleContract.address, ticketPrice)
    ).wait();
    (await this.raffleContract.connect(this.signer).enterWithToken()).wait();
  }

  async determineWinner(event: string = 'NewWinner') {
    const receipt = await (await this.raffleContract.connect(this.signer).determineWinner()).wait();
    const filteredEvent = receipt.events?.filter((x) => {
      return x.event == event;
    })[0];
    return filteredEvent && filteredEvent.args;
  }

  async restartRaffle({
    ticketPrice,
    duration,
  }: {
    ticketPrice: BigNumberish;
    duration: BigNumberish;
  }) {
    (await this.raffleContract.connect(this.signer).restartRaffle(ticketPrice, duration)).wait();
  }

  async getEthBalance() {
    return this.signer.getBalance();
  }

  async getTokenBalance() {
    return this.tokenContract.balanceOf(await this.signer.getAddress());
  }
}
