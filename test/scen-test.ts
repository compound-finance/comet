// XXX
import { Runner } from '../plugins/scenario/Runner'
import { BalanceConstraint } from '../scenario/Constraints'
import { CometContextCreator } from '../scenario/Context'

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
  contextCreator: new CometContextCreator,
}).run(scenarios)
  .then(r => { /* console.trace(r) */ })
  .catch(e => { throw(e) });
