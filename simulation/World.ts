export class World {
  prevailingRates() {
    return {
      supplyRate: 0.0225,
      borrowRate: 0.0150, // XXX this means a user will only borrow if IR < 1.5% (the SOFR rate)
    };
  }
}