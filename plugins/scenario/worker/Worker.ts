import { parentPort } from 'worker_threads';
import { ForkSpec, Runner } from '../Runner';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { HardhatContext } from "hardhat/internal/context";
import { scenarioGlob } from './Config';
import { getEthersContractsForDeployment } from "../../spider";
import { HardhatConfig, HardhatArguments, createContext, setConfig, getContext } from './HardhatContext';
import * as util from 'util';
import { ScenarioConfig } from '../types';
import { AssertionError } from 'chai';

interface Message {
  scenario?: {
    base: string,
    scenario: string
  }
};

function eventually(fn: () => void) {
  setTimeout(fn, 0);
}

export async function run<T>({scenarioConfig, bases, config}: {scenarioConfig: ScenarioConfig, bases: ForkSpec[], config: [HardhatConfig, HardhatArguments]}) {
  createContext(...config);
  let scenarios: { [name: string]: Scenario<T> } = await loadScenarios(scenarioGlob);
  let baseMap = Object.fromEntries(bases.map((base) => [base.name, base]));

  async function runScenario<T>(base: ForkSpec, scenario: Scenario<T>) {
    await new Runner({
      bases: [base],
      constraints: [],
    }).run([scenario]);
  }

  parentPort.on('message', async (message: Message) => {
    if (message.scenario) {
      console.log(message);
      let { scenario: scenarioName, base: baseName } = message.scenario;
      console.log({scenarioName, baseName});
      let scenario = scenarios[scenarioName];
      if (!scenario) {
        throw new Error(`Worker encountered unknown scenario: ${scenarioName}`);
      }
      let base = baseMap[baseName];
      if (!base) {
        throw new Error(`Worker encountered unknown base: ${baseName}`);
      }

      let startTime = Date.now();
      try {
        await runScenario(base, scenario);
        // Add timeout for flush
        eventually(() => parentPort.postMessage({result: { base: base.name, scenario: scenario.name, elapsed: Date.now() - startTime, error: null, trace: null }}));
      } catch (error) {
        let diff = null;
        if (error instanceof AssertionError) {
          let { actual, expected } = <any>error; // Types unclear
          if (actual !== expected) {
            diff = { actual, expected };
          }
        }
        // Add timeout for flush
        eventually(() => parentPort.postMessage({result: { base: base.name, scenario: scenario.name, elapsed: Date.now() - startTime, error, trace: error.stack.toString(), diff }}));
      }
    } else {
      throw new Error(`Unknown or invalid worker message: ${JSON.stringify(message)}`);
    }
  });
}
