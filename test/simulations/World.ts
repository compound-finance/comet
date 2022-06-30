export class World {
  constructor() { }

  prevailingRates() {
    return {
      supplyRate: 0.02,
      borrowRate: 0.015, // XXX this means a user will only borrow if IR < 1.5%
    }
  }
}