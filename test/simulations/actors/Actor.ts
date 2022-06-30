import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumberish } from "ethers";
import { FaucetToken } from "../../../build/types";
import { exp, wait } from "../../helpers";
import { Market } from "../Market";
import { World } from "../World";

export abstract class Actor {
  signer: SignerWithAddress;
  params: string; // XXX
  desiredSupplyRate: number;
  desiredBorrowRate: number;

  constructor(signer: SignerWithAddress) {
    this.signer = signer;
    // this.params = params; // XXX whaleishness, sentiment, risk appetite
  }

  // XXX support negative amount as withdraw
  async supply(market: Market, asset: FaucetToken, amount: BigNumberish) {
    await wait(asset.connect(this.signer).approve(market.comet.address, amount));
    await (wait(market.comet.connect(this.signer).supply(asset.address, amount)));
  }

  // XXX support negative amount as repay
  async borrow(market: Market, asset: FaucetToken, amount: BigNumberish) {
    await (wait(market.comet.connect(this.signer).withdraw(asset.address, amount)));
  }

  async updateDesiredRates(world: World) {
    this.desiredSupplyRate = world.prevailingRates().supplyRate;
    this.desiredBorrowRate = world.prevailingRates().borrowRate;
  }

  abstract act(world: World, market: Market, t: number);
}