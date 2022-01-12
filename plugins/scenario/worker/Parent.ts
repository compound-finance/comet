import * as path from 'path';
import { Worker } from 'worker_threads';
import { ForkSpec } from '../World';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { defaultFormats, scenarioGlob, workerCount } from './Config';
import { showReport } from './Report';
import { getContext, getConfig, getHardhatArguments } from './HardhatContext';
import { ScenarioConfig } from '../types';
import { HardhatConfig } from 'hardhat/types';

export interface Result {
  base: string;
  file: string;
  scenario: string;
  elapsed?: number;
  error?: Error;
  trace?: string;
  diff?: { actual: any; expected: any };
  skipped?: boolean;
}

interface WorkerMessage {
  result?: Result;
}

type BaseScenario<T> = {
  base: ForkSpec;
  scenario: Scenario<T>;
};

function filterRunning<T>(
  baseScenarios: BaseScenario<T>[]
): [BaseScenario<T>[], BaseScenario<T>[]] {
  let rest = baseScenarios.filter(({ scenario }) => scenario.flags === null);
  let only = baseScenarios.filter(({ scenario }) => scenario.flags === 'only');
  let skip = baseScenarios.filter(({ scenario }) => scenario.flags === 'skip');

  if (only.length > 0) {
    return [only, skip.concat(rest)];
  } else {
    return [rest, skip];
  }
}

function getBaseScenarios<T>(bases: ForkSpec[], scenarios: Scenario<T>[]): BaseScenario<T>[] {
  let result: BaseScenario<T>[] = [];

  // Note: this could filter if scenarios had some such filtering (e.g. to state the scenario is only compatible with certain bases)
  for (let base of bases) {
    for (let scenario of scenarios) {
      result.push({ base, scenario });
    }
  }
  return result;
}

function key(baseName: string, scenarioName: string): string {
  return `${baseName}-${scenarioName}`;
}

// Strips out unserializable fields such as functions.
function convertToSerializableObject(object: object) {
  return JSON.parse(JSON.stringify(object));
}

export async function runScenario<T>(scenarioConfig: ScenarioConfig, bases: ForkSpec[]) {
  let hardhatConfig = convertToSerializableObject(getConfig()) as HardhatConfig;
  let hardhatArguments = getHardhatArguments();
  let formats = defaultFormats;
  let scenarios: Scenario<T>[] = Object.values(await loadScenarios(scenarioGlob));
  let baseScenarios: BaseScenario<T>[] = getBaseScenarios(bases, scenarios);
  let [runningScenarios, skippedScenarios] = filterRunning(baseScenarios);

  let startTime = Date.now();

  let results: Result[] = skippedScenarios.map(({ base, scenario }) => ({
    base: base.name,
    file: scenario.file || scenario.name,
    scenario: scenario.name,
    elapsed: undefined,
    error: undefined,
    skipped: true,
  }));
  let pending: Set<string> = new Set(
    runningScenarios.map((baseScenario) => key(baseScenario.base.name, baseScenario.scenario.name))
  );
  let assignable: Iterator<BaseScenario<T>> = runningScenarios[Symbol.iterator]();
  let done;
  let hasError = false;
  let isDone = new Promise((resolve, reject_) => {
    done = resolve;
  });

  function checkDone() {
    if (pending.size === 0) {
      done();
    }
  }

  checkDone(); // Just in case we don't have any scens

  function getNextScenario(): BaseScenario<T> | null {
    let next = assignable.next();
    if (!next.done && next.value) {
      return next.value;
    }
    return null;
  }

  function assignWork(worker: Worker) {
    let baseScenario = getNextScenario();
    if (baseScenario) {
      worker.postMessage({
        scenario: {
          base: baseScenario.base.name,
          scenario: baseScenario.scenario.name,
        },
      });
    }
  }

  function mergeResult(index: number, result: Result) {
    results.push(result);
    pending.delete(key(result.base, result.scenario));

    checkDone();
  }

  const envWorkers = process.env['WORKERS'];
  const trueWorkerCount = envWorkers ? Number(envWorkers) : workerCount;
  if (Number.isNaN(trueWorkerCount) || trueWorkerCount <= 0) {
    throw new Error(`Invalid worker count: ${envWorkers}`);
  }

  const worker = [...new Array(trueWorkerCount)].map((_, index) => {
    let worker = new Worker(path.resolve(__dirname, './BootstrapWorker.js'), {
      workerData: {
        scenarioConfig,
        bases,
        config: [hardhatConfig, hardhatArguments],
      },
    });

    worker.on('message', (message) => {
      if (message.result) {
        mergeResult(index, message.result);
        assignWork(worker);
      }
    });

    assignWork(worker);
  });

  await isDone;

  let endTime = Date.now();

  await showReport(results, formats, startTime, endTime);

  if (results.some((result) => result.error)) {
    process.exit(1); // Exit as failure
  }
}
