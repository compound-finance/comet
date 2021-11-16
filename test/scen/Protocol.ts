export class Actor {
  absorb({to, accounts}) {
    console.log('xxx absorb tx', arguments)
  }

  buyCollateral({asset, minAmount, baseAmount, recipient}) {
    console.log('xxx buy collateral tx', arguments)
  }

  pause({supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused}) {
    console.log('xxx pause tx', arguments)
  }

  allow({manager, isAllowed}) {
    console.log('xxx allow tx', arguments)
  }

  allowBySig({manager, isAllowed, nonce, expiry, signature}) {
    console.log('xxx allow by sig tx', arguments)
  }

  supply({from, dst, asset, amount}) {
    console.log('xxx supply tx', arguments)
  }

  transfer({src, dst, asset, amount}) {
    console.log('xxx transfer tx', arguments)
  }

  withdraw({src, to, asset, amount}) {
    console.log('xxx withdraw tx', arguments)
  }

  withdrawReserves({to, amount}) {
    console.log('xxx withdraw reserves tx', arguments)
  }

  withdrawMaxWithBorrowing() {
    // XXX decide do we have a contract helper for this in bulker?
    console.log('xxx withdraw max up to borrow limit tx', arguments)
  }
}