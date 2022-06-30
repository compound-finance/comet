import { exp } from "../../helpers";
import { Actor } from "./Actor";
import { Market } from "../Market";
import { World } from "../World";

export class Borrower extends Actor {
  async act(world: World, market: Market, t: number) {
    await this.updateDesiredRates(world);
    const rates = await market.currentRates();

    if (rates.netBorrowRate < this.desiredBorrowRate) {
      // XXX borrow demand should change based on heuristics such as market sentiment

      // For now, to keep things simple, we will cap the borrow amount at 5mn USDC each time
      // XXX figure out what optimal borrow is. should take into account the borrow rate AFTER borrowing
      const optimalBorrow = exp(10_000_000, 6);
      const maxBorrow = exp(5_000_000, 6);
      const borrowAmount = optimalBorrow > maxBorrow ? maxBorrow : optimalBorrow;
      await this.borrow(market, market.baseAsset, borrowAmount);
    }
  }
}