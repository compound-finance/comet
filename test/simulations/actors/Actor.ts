import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumberish } from "ethers";
import { FaucetToken } from "../../../build/types";
import { exp, wait } from "../../helpers";
import { Market } from "../Market";
import { World } from "../World";

export class Actor {
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

  async act(world: World, market: Market, t: number) {
    await this.updateDesiredRates(world);
    const rates = await market.currentRates();
    // Behavior:
    // If supply rate is high, will supply
    // If borrow rate is low, will borrow
    // XXX For existing borrowers, if borrow rate is high, will withdraw???
    if (rates.supplyRate > this.desiredSupplyRate) {
      // Supply at most 10mn USDC to test incremental differences in total supply
      const baseBalance = await market.baseAsset.balanceOf(this.signer.address);
      const maxSupply = exp(10_000_000, 6);
      const supplyAmount = baseBalance.toBigInt() > maxSupply ? maxSupply : baseBalance;
      await this.supply(market, market.baseAsset, supplyAmount);
    } else if (rates.netBorrowRate < this.desiredBorrowRate) {
      // XXX borrow demand should change based on heuristics

      // For now, to keep things simple, we will cap the borrow amount at 5mn USDC each time
      // XXX figure out what optimal borrow is. should take into account the borrow rate AFTER borrowing
      const optimalBorrow = exp(10_000_000, 6);
      const maxBorrow = exp(5_000_000, 6);
      const borrowAmount = optimalBorrow > maxBorrow ? maxBorrow : optimalBorrow;
      await this.borrow(market, market.baseAsset, borrowAmount);
    }
  }
}