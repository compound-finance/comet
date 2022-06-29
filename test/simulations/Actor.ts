import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumberish } from "ethers";
import { FaucetToken } from "../../build/types";
import { wait } from "../helpers";
import { Market } from "./Market";
import { World } from "./World";

export class Actor {
  signer: SignerWithAddress;
  params: string; // XXX
  desiredSupplyRate: number;
  desiredBorrowRate: number;

  constructor(signer: SignerWithAddress) {
    this.signer = signer;
    // this.params = params; // XXX whaleishness, sentiment, risk appetite
  }

  async supply(market: Market, asset: FaucetToken, amount: BigNumberish) {
    await wait(asset.connect(this.signer).approve(market.comet.address, amount));
    await (wait(market.comet.connect(this.signer).supply(asset.address, amount)));
  }

  async borrow(market: Market, asset: FaucetToken, amount: BigNumberish) {
    // XXX supply collateral first, OR JUST SEED ALL ACTORS WITH AMPLE COLLATERAL
    await (wait(market.comet.connect(this.signer).withdraw(asset.address, amount)));
  }

  async updateDesiredRates(world: World) {
    this.desiredSupplyRate = world.prevailingRates().supplyRate;
    this.desiredBorrowRate = world.prevailingRates().borrowRate;
  }

  async act(world: World, market: Market, t: number) {
    await this.updateDesiredRates(world);
    const rates = await market.currentRates();
    if (rates.supplyRate > this.desiredSupplyRate) {
      // XXX be smarter about how much to deposit, since whales don't necessarily deposit all their balance if it moves the market
      const baseAmount = await market.baseAsset.balanceOf(this.signer.address);
      await this.supply(market, market.baseAsset, baseAmount);
    } else if (rates.borrowRate < this.desiredBorrowRate) { // XXX change to net borrow rate
      // XXX borrow demand should change based on heuristics
    }
  }
}