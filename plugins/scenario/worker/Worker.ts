import { parentPort } from 'worker_threads';
import { Runner } from '../Runner';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { HardhatContext } from "hardhat/internal/context";
import { scenarioGlob } from './Config';
import { getEthersContractsForDeployment } from "../../spider";
import { HardhatConfig, HardhatArguments, createContext, setConfig, getContext } from './HardhatContext';
import * as util from 'util';
import { ScenarioConfig } from '../types';

interface Message {
  config?: [HardhatConfig, HardhatArguments],
  scenario?: string
};

function eventually(fn: () => void) {
  setTimeout(fn, 0);
}

export async function run<T>(scenarioConfig: ScenarioConfig) {
  let scenarios: { [name: string]: Scenario<T> } = await loadScenarios(scenarioGlob);

  async function runScenario<T>(scenario: Scenario<T>) {
    await new Runner({
      bases: scenarioConfig.bases,
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
        // Add timeout for flush
        eventually(() => parentPort.postMessage({result: { scenario: scenario.name, elapsed: Date.now() - startTime, error: null }}));
      } catch (error) {
        // Add timeout for flush
        eventually(() => parentPort.postMessage({result: { scenario: scenario.name, elapsed: Date.now() - startTime, error }}));
      }
    } else {
      throw new Error(`Unknown or invalid worker message: ${JSON.stringify(message)}`);
    }
  });
}
