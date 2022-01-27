import * as path from 'path';
import { Worker } from 'worker_threads';
import { ForkSpec } from '../World';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { defaultFormats, scenarioGlob, workerCount } from './Config';
import { showReport } from './Report';
import { getConfig, getHardhatArguments } from './HardhatContext';
import { ScenarioConfig } from '../types';
import { HardhatConfig } from 'hardhat/types';
import { SimpleWorker } from './SimpleWorker';

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

function filterRunning<T>(
  scenarios: Scenario<T>[]
): [Scenario<T>[], Scenario<T>[]] {
  let rest = scenarios.filter(scenario => scenario.flags === null);
  let only = scenarios.filter(scenario => scenario.flags === 'only');
  let skip = scenarios.filter(scenario => scenario.flags === 'skip');

  if (only.length > 0) {
    return [only, skip.concat(rest)];
  } else {
    return [rest, skip];
  }
}

function key(scenarioName: string): string {
  return `${scenarioName}`;
}

// Strips out unserializable fields such as functions.
function convertToSerializableObject(object: object) {
  return JSON.parse(JSON.stringify(object));
}

export async function runScenario<T>(scenarioConfig: ScenarioConfig, bases: ForkSpec[], workerCount: number, async: boolean) {
  let hardhatConfig = convertToSerializableObject(getConfig()) as HardhatConfig;
  let hardhatArguments = getHardhatArguments();
  let formats = defaultFormats;
  let scenarios: Scenario<T>[] = Object.values(await loadScenarios(scenarioGlob));
  let [runningScenarios, skippedScenarios] = filterRunning(scenarios);

  let startTime = Date.now();

  let results: Result[] = skippedScenarios.flatMap(scenario => {
    return bases.map(base => ({
      base: base.name,
      file: scenario.file || scenario.name,
      scenario: scenario.name,
      elapsed: undefined,
      error: undefined,
      skipped: true,
    }))
  });
  let pending: Set<string> = new Set(
    runningScenarios.map(scenario => key(scenario.name))
  );
  let assignable: Iterator<Scenario<T>> = runningScenarios[Symbol.iterator]();
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

  function getNextScenario(): Scenario<T> | null {
    let next = assignable.next();
    if (!next.done && next.value) {
      return next.value;
    }
    return null;
  }

  function assignWork(worker: Worker) {
    let scenario = getNextScenario();
    if (scenario) {
      worker.postMessage({
        scenario: {
          scenario: scenario.name,
        },
      });
    }
  }

  function mergeResult(index: number, result: Result) {
    results.push(result);
    pending.delete(key(result.scenario));

    checkDone();
  }

  [...new Array(workerCount)].map((_, index) => {
    let worker;
    if (async) {
      worker = new Worker(path.resolve(__dirname, './BootstrapWorker.js'), {
        workerData: {
          scenarioConfig,
          bases,
          config: [hardhatConfig, hardhatArguments],
        },
      });
    } else {
      worker = new SimpleWorker({
        scenarioConfig,
        bases,
        config: [hardhatConfig, hardhatArguments],
      });

      worker.run();
    }

    worker.on('message', (message) => {
      if (message.results) {
        for (let result of message.results) {
          mergeResult(index, result);
        }
        assignWork(worker);
      }
    });

    assignWork(worker);
  });

  await isDone;

  let endTime = Date.now();

  await showReport(results, formats, startTime, endTime);

  if (results.some((result) => result.error)) {
    setTimeout(() => { // Deferral to allow potential console flush
      process.exit(1); // Exit as failure
    }, 0);
  }
}
