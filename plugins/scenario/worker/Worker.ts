import { parentPort } from 'worker_threads';
import { Runner } from '../Runner';
import { ForkSpec, World } from '../World';
import { Scenario } from '../Scenario';
import { getLoader, loadScenarios } from '../Loader';
import { scenarioGlob } from './Config';
import { HardhatConfig, HardhatArguments, createContext } from './HardhatContext';
import { ScenarioConfig } from '../types';
import { SimpleWorker } from './SimpleWorker';
import hreForBase from '../utils/hreForBase';
import { Result } from './Parent';
import { pluralize } from './Report';

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
  let runners = {};

  if (!worker) {
    // only create if we're not in a simple worker
    createContext(...config);
    scenarios = await loadScenarios(scenarioGlob);
  } else {
    scenarios = getLoader<T>().getScenarios();
  }

  for (let base of bases) {
    let world = new World(hreForBase(base), base);
    let runner = new Runner({ base, world });
    runners[base.name] = runner;
  }

  onMessage(worker, async (message: Message) => {
    if (message.scenario) {
      let { scenario: scenarioName, base } = message.scenario;
      let scenario = scenarios[scenarioName];
      if (!scenario) {
        throw new Error(`Worker encountered unknown scenario: ${scenarioName}`);
      }

      console.log('Running', scenarioName, base);
      try {
        let result = await runners[base].run(scenario);
        eventually(() => {
          postMessage(worker, { result });
        });
        let numSolutionSets = result.numSolutionSets ?? 0;
        console.log(`Ran ${pluralize(numSolutionSets, 'solution', 'solutions')} for ${base}:${scenarioName}`);
      } catch (e) {
        console.error('Encountered worker error', e);
        eventually(() => {
          throw e;
        });
      }
    } else {
      throw new Error(`Unknown or invalid worker message: ${JSON.stringify(message)}`);
    }
  });
}
