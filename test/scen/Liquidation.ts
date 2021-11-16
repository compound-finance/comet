import Scenario from './Scenario'

export default class LiquidationScen extends Scenario {
  aliases() {
    return {
      'Governor': '0xff...',
      'wETH': '0x235...',
    }
  }

  // this is not allowed on AScenarios?
  unlocked() {
    return ['Governor']
  }

  // any fn we would specify from on should be part of actor
  async setupUnderwater(actor) {
    const {apr} = this.lib()
    await actor.supply({asset: 'wETH', amount: 100})
    await actor.withdrawMaxWithBorrowing()
    await this.suppose({borrowRate: {atLeast: apr(6)}})
    await this.timeTravel({days: 365})
  }

  async testLiquidateSuccess({a, b}) {
    await this.setupUnderwater(a)
    await b.absorb(a)
    await b.buyCollateral({asset: 'wETH', amount: 100, stableAmount: 500000})
  }

  async testLiquidateFailure({a, b}) {
    await this.setupUnderwater(a)
    await b.absorb(a)
    await b.buyCollateral({asset: 'wETH', amount: 100, stableAmount: 10})
  }
}
