import { task } from 'hardhat/config';
import { Runner } from '../../test/scen2/Runner';

task("scenario", "Runs scenario tests")
  .setAction(async (_taskArgs) => {
    new Runner({
      bases: [
        {
          name: "mainnet",
          url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_MAINNET_KEY}`,
          blockNumber: 10000
        }
      ],
      constraints: [],
      getInitialContext: async (world) => ({})
    }).run([])
      .then(r => { /* console.trace(r) */ })
      .catch(e => { throw(e) });

  });