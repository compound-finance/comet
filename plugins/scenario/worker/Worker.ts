import { parentPort } from 'worker_threads';
import { Runner } from '../Runner';
import { ForkSpec } from '../World';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { HardhatContext } from 'hardhat/internal/context';
import { scenarioGlob } from './Config';
import {
  HardhatConfig,
  HardhatArguments,
  createContext,
  setConfig,
  getContext,
} from './HardhatContext';
import * as util from 'util';
import { ScenarioConfig } from '../types';
import { AssertionError } from 'chai';

interface Message {
  scenario?: {
    base: string;
    scenario: string;
  };
}

function eventually(fn: () => void) {
  setTimeout(fn, 0);
}

export async function run<T>({
  scenarioConfig,
  bases,
  config,
}: {
  scenarioConfig: ScenarioConfig;
  bases: ForkSpec[];
  config: [HardhatConfig, HardhatArguments];
}) {
  createContext(...config);
  let scenarios: { [name: string]: Scenario<T> } = await loadScenarios(scenarioGlob);
  let baseMap = Object.fromEntries(bases.map((base) => [base.name, base]));

  parentPort.on('message', async (message: Message) => {
    if (message.scenario) {
      let { scenario: scenarioName, base: baseName } = message.scenario;
      let scenario = scenarios[scenarioName];
      if (!scenario) {
        throw new Error(`Worker encountered unknown scenario: ${scenarioName}`);
      }
      let base = baseMap[baseName];
      if (!base) {
        throw new Error(`Worker encountered unknown base: ${baseName}`);
      }

      let resultFn = (base: ForkSpec, scenario: Scenario<T>, err: any) => {
        let diff = null;
        if (err instanceof AssertionError) {
          let { actual, expected } = <any>err; // Types unclear
          if (actual !== expected) {
            diff = { actual, expected };
          }
        }
        // Add timeout for flush
        eventually(() =>
          parentPort.postMessage({
            result: {
              base: base.name,
              file: scenario.file || scenario.name,
              scenario: scenario.name,
              elapsed: Date.now() - startTime,
              error: err || null,
              trace: err ? err.stack : null,
              diff, // XXX can we move this into parent?
            },
          })
        );
      };

      console.log('Running', message.scenario);
      let startTime = Date.now();
      try {
        await new Runner({ bases: [base] }).run([scenario], resultFn);
      } catch (e) {
        console.error('Encountered worker error', e);
        eventually(() => {
          throw e;
        });
      }
      console.log('Ran', scenario);
    } else {
      throw new Error(`Unknown or invalid worker message: ${JSON.stringify(message)}`);
    }
  });
}
