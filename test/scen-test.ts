import hre from 'hardhat'

// XXX
import { Runner } from './scen2/Runner'
import { BalanceConstraint } from './scen2/CometScenario'

const scenarios = []; // XXX
new Runner({
  bases: ['mainnet@>=100000', 'mainnet@1000000'],
  constraints: [new BalanceConstraint],
  getInitialContext: async (world) => ({})
}).run(hre, scenarios)
  .then(r => { /* console.trace(r) */ })
  .catch(e => { throw(e) });
