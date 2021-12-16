import { task } from 'hardhat/config';
import { Runner } from '../../test/scen2/Runner';
import { getEthersContractsForDeployment } from "../spider/spider";

task("scenario", "Runs scenario tests")
  .setAction(async (_taskArgs) => {
    await new Runner({
      bases: [
        {
          name: "mainnet",
          url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_MAINNET_KEY}`
        }
      ],
      constraints: [],
      getInitialContext: async (world, base) => {
        const contracts = await getEthersContractsForDeployment(world.hre, base.name);
        return contracts;
      },
      forkContext: async (context) => Object.assign({}, context), // XXX how to clone
    }).run([]);
  });