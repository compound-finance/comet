import { exp, min } from "../../helpers";
import { Actor } from "./Actor";
import { Market } from "../Market";
import { World } from "../World";

export class Supplier extends Actor {
  async act(world: World, market: Market, t: number) {
    await this.updateDesiredRates(world);
    const rates = await market.currentRates();

    if (rates.supplyRate > this.desiredSupplyRate) {
      // Supply at most 10mn USDC to test incremental differences in total supply
      const baseBalance = (await market.baseAsset.balanceOf(this.signer.address)).toBigInt();
      const maxSupply = exp(10_000_000, 6);
      const supplyAmount = min(baseBalance, maxSupply);
      await this.supply(market, market.baseAsset, supplyAmount);
    }
  }
}