import { parentPort } from 'worker_threads';
import { Runner } from '../Runner';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { HardhatContext } from "hardhat/internal/context";
import { scenarioGlob } from './Config';
import { getEthersContractsForDeployment } from "../../spider";

interface Message {
  scenario?: string
};

type GlobalWithHardhatContext = typeof global & {
  __hardhatContext: HardhatContext;
};

function setHardhatContext() {
  // TODO: I'm not sure this is ideal, inspired by these lines: https://github.com/nomiclabs/hardhat/blob/4f108b51fc7f87bcf7f173a4301b5973918b4903/packages/hardhat-core/src/internal/context.ts#L13-L40
  (global as GlobalWithHardhatContext).__hardhatContext = HardhatContext.createHardhatContext();
}

export async function run<T>() {
  setHardhatContext();

	let scenarios: { [name: string]: Scenario<T> } = await loadScenarios(scenarioGlob);

  async function runScenario<T>(scenario: Scenario<T>) {
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
    }).run([scenario]);
  }

  parentPort.on('message', async (message: Message) => {
    if (message.scenario) {
      let scenarioName = message.scenario;
      let scenario = scenarios[scenarioName];
      if (!scenario) {
        throw new Error(`Worker encountered unknown scenario: ${scenarioName}`);
      }

      let startTime = Date.now();
      try {
        await runScenario(scenario);
        parentPort.postMessage({result: { scenario: scenario.name, elapsed: Date.now() - startTime, error: null }});
      } catch (error) {
        parentPort.postMessage({result: { scenario: scenario.name, elapsed: Date.now() - startTime, error }});
      }
    } else {
      throw new Error(`Unknown or invalid worker message: ${JSON.stringify(message)}`);
    }
  });
}
