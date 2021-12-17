// XXX
import { Runner } from '../plugins/scenario/Runner'
import { CometContext, BalanceConstraint } from '../plugins/scenario/CometScenario'

const scenarios = []; // XXX
new Runner({
  bases: [
    {
      name: "mainnet",
      url: `https://eth-mainnet.alchemyapi.io/v2/-lH3DVZ5yNTgaJjsituB9PssBzM3SN-R`
      blockNumber: 10000
    },
    {
      name: "mainnet",
      url: `https://eth-mainnet.alchemyapi.io/v2/-lH3DVZ5yNTgaJjsituB9PssBzM3SN-R`
      blockNumber: 1000000
    }
  ],
  constraints: [new BalanceConstraint],
  getInitialContext: async (world) => new CometContext(world),
  forkContext: async (context) => Object.assign({}, context), // XXX how to clone
}).run(scenarios)
  .then(r => { /* console.trace(r) */ })
  .catch(e => { throw(e) });
