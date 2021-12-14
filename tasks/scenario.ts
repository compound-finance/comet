import { task } from 'hardhat/config';

// import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatContext } from "hardhat/internal/context";
import { loadConfigAndTasks } from "hardhat/internal/core/config/config-loading";
import { getEnvHardhatArguments } from "hardhat/internal/core/params/env-variables";
import { HARDHAT_PARAM_DEFINITIONS } from "hardhat/internal/core/params/hardhat-params";
import { Environment } from "hardhat/internal/core/runtime-environment";

import { expect } from "chai";

// TODO: move into hardhat.config.ts
const scenarioNetworks = {
  mainnet: {
    forking: {
      url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_MAINNET_KEY}`,
      enabled: true
    }
  },
  rinkeby: {
    forking: {
      url: `https://eth-rinkeby.alchemyapi.io/v2/${process.env.ALCHEMY_RINKEBY_KEY}`,
      enabled: true
    }
  }
};

async function testRunner(networkName, hre) {
  console.log(`Running test on fork of ${networkName}`);

  await hre.ethers.provider.getBlockNumber().then((blockNumber) => {
    console.log("Current block number: " + blockNumber);
  });

  const {ethers} = hre;

  // https://hardhat.org/guides/waffle-testing.html#testing
  const Greeter = await ethers.getContractFactory("Greeter");
  const greeter = await Greeter.deploy("Hello, world!");
  await greeter.deployed();

  expect(await greeter.greet()).to.equal("Hello, world!");

  const setGreetingTx = await greeter.setGreeting("Hola, mundo!");

  // wait until the transaction is mined
  await setGreetingTx.wait();

  expect(await greeter.greet()).to.equal("Hola, mundo!");

  console.log('\n');
}

task("scenario", "Runs scenario tests")
  .setAction(async (_taskArgs) => {
    const ctx: HardhatContext = HardhatContext.getHardhatContext();

    const hardhatArguments = getEnvHardhatArguments(
      HARDHAT_PARAM_DEFINITIONS,
      process.env
    );

    const config = loadConfigAndTasks(hardhatArguments);

    const { networks: { hardhat: defaultNetwork } } = config;

    for (const networkName in scenarioNetworks) {
      const forkedNetwork = {
        ...defaultNetwork,
        ...scenarioNetworks[networkName]
      };
      const forkedConfig = {
        ...config,
        ...{
          defaultNetwork: "hardhat",
          networks: {
            hardhat: forkedNetwork,
            localhost: config.networks.localhost
          }
        }
      }

      const forkedHre = new Environment(
        forkedConfig,
        hardhatArguments,
        ctx.tasksDSL.getTaskDefinitions(),
        ctx.extendersManager.getExtenders(),
        ctx.experimentalHardhatNetworkMessageTraceHooks
      );

      await testRunner(networkName, forkedHre);
    }
  });