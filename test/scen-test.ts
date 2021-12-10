import hre from 'hardhat'

// XXX
import { Runner } from './scen2/Runner'
import { BalanceConstraint } from './scen2/CometScenario'

new Runner({
  bases: ['mainnet@>=100000', 'mainnet@1000000'],
  supposers: [BalanceConstraint]
}).run(hre)
  .then(r => { /* console.trace(r) */ })
  .catch(e => { throw(e) });
