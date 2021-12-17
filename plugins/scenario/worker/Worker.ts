import { parentPort } from 'worker_threads';
import { Runner } from '../Runner';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { HardhatContext } from "hardhat/internal/context";
import { scenarioGlob } from './Config';
import { getEthersContractsForDeployment } from "../../spider";
import { HardhatConfig, HardhatArguments, createContext, setConfig, getContext } from './HardhatContext';
// import 'hardhat/internal/lib/hardhat-lib'
import * as util from 'util';

interface Message {
  config?: [HardhatConfig, HardhatArguments],
  scenario?: string
};

export async function run<T>() {
  let scenarios: { [name: string]: Scenario<T> } = await loadScenarios(scenarioGlob);

  async function runScenario<T>(scenario: Scenario<T>) {
/** SCOTT **/
    await new Runner({
      bases: [
        {
          name: "mainnet",
          url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_MAINNET_KEY}`
        }
      ],
      constraints: [],
    }).run([scenario]);
  }

  parentPort.on('message', async (message: Message) => {
    if (message.config) {
      createContext(...message.config);
    } else if (message.scenario) {
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
