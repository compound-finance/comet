// XXX
import { Runner } from './scen2/Runner'
import { BalanceConstraint } from './scen2/CometScenario'

const scenarios = []; // XXX
new Runner({
  bases: [
    {
      name: "mainnet",
      url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_MAINNET_KEY}`,
      blockNumber: 10000
    },
    {
      name: "mainnet",
      url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_MAINNET_KEY}`,
      blockNumber: 1000000
    }
  ],
  constraints: [new BalanceConstraint],
  getInitialContext: async (world) => ({})
}).run(scenarios)
  .then(r => { /* console.trace(r) */ })
  .catch(e => { throw(e) });
