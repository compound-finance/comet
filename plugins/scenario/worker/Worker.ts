import { parentPort } from 'worker_threads';
import { Runner } from '../Runner';
import { ForkSpec, World } from '../World';
import { Scenario } from '../Scenario';
import { getLoader, loadScenarios } from '../Loader';
import { scenarioGlob } from './Config';
import { HardhatConfig, HardhatArguments, createContext } from './HardhatContext';
import { ScenarioConfig } from '../types';
import { SimpleWorker } from './SimpleWorker';
import { pluralize } from './Report';
import { DeploymentManager } from '../../deployment_manager';

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

async function runDeployScript(dm: DeploymentManager, baseName: string) {
  const delta = await dm.runDeployScript({ allMissing: true });
  console.log(`[${baseName}] Deployed ${dm.counter} contracts, spent ${dm.spent} to initialize world 🗺`);
  console.log(`[${baseName}]\n${dm.diffDelta(delta)}`);
}

export async function run<T, U, R>({ bases, config, worker }: WorkerData) {
  let scenarios: { [name: string]: Scenario<T, U, R> };
  let runners = {};

  if (!worker) {
    // only create if we're not in a simple worker
    createContext(...config);
    scenarios = await loadScenarios(scenarioGlob);
  } else {
    scenarios = getLoader<T, U, R>().getScenarios();
  }

  for (const base of bases) {
    const world = new World(base);
    const dm = world.deploymentManager;
    await runDeployScript(dm, base.name);

    if (world.auxiliaryDeploymentManager) {
      await world.auxiliaryDeploymentManager.spider();
    }

    runners[base.name] = new Runner({ base, world });
  }

  onMessage(worker, async (message: Message) => {
    if (message.scenario) {
      let { scenario: scenarioName, base: baseName } = message.scenario;
      let scenario = scenarios[scenarioName];
      if (!scenario) {
        throw new Error(`Worker encountered unknown scenario: ${scenarioName}`);
      }

      console.log(`[${baseName}] Running ${scenarioName} ...`);
      try {
        let result = await runners[baseName].run(scenario);
        eventually(() => {
          postMessage(worker, { result });
        });
        let numSolutionSets = result.numSolutionSets ?? 0;
        console.log(`[${baseName}] ... ran ${scenarioName} on ${pluralize(numSolutionSets, 'solution', 'solutions')}`);
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
