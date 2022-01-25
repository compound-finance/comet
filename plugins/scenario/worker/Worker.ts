import { parentPort } from 'worker_threads';
import { Runner } from '../Runner';
import { ForkSpec } from '../World';
import { Scenario } from '../Scenario';
import { getLoader, loadScenarios } from '../Loader';
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
import { SimpleWorker } from './SimpleWorker';

interface Message {
  scenario?: {
    base: string;
    scenario: string;
  };
}

export type WorkerData = {
  scenarioConfig: ScenarioConfig;
  bases: ForkSpec[];
  config: [HardhatConfig, HardhatArguments];
  worker?: SimpleWorker;
};

// Helper function to cede control fo the thread
// JavaScript's scheduler is cooperative, so we cede control by asking for
// a timer callback. Once the scheduler gives us back control, we execute `f`.
function eventually(fn: () => void) {
  setTimeout(fn, 0);
}

function onMessage(worker: SimpleWorker | undefined, f: (message: Message) => Promise<void>) {
  if (worker) {
    worker.onParent('message', f);
  } else {
    parentPort.on('message', f);
  }
}

function postMessage(worker: SimpleWorker | undefined, message: any) {
  if (worker) {
    worker.postParentMessage(message);
  } else {
    parentPort.postMessage(message);
  }
}

export async function run<T>({ scenarioConfig, bases, config, worker }: WorkerData) {
  let scenarios: { [name: string]: Scenario<T> };

  if (!worker) {
    // only create if we're not in a simple worker
    createContext(...config);
    scenarios = await loadScenarios(scenarioGlob);
  } else {
    scenarios = getLoader<T>().getScenarios();
  }

  let baseMap = Object.fromEntries(bases.map((base) => [base.name, base]));

  onMessage(worker, async (message: Message) => {
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
          postMessage(worker, {
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
