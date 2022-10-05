import * as path from 'path';
import { Worker } from 'worker_threads';
import { ForkSpec } from '../World';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { defaultFormats, scenarioGlob } from './Config';
import { showReport } from './Report';
import { getConfig, getHardhatArguments } from './HardhatContext';
import { ScenarioConfig } from '../types';
import { HardhatConfig } from 'hardhat/types';
import { SimpleWorker } from './SimpleWorker';
import { pluralize } from './Report';

type BaseScenario<T, U, R> = {
  base: ForkSpec;
  scenario: Scenario<T, U, R>;
};

export interface Result {
  base: string;
  file: string;
  scenario: string;
  gasUsed?: number;
  numSolutionSets?: number;
  elapsed?: number;
  error?: Error;
  trace?: string;
  diff?: { actual: any, expected: any };
  skipped?: boolean;
}

function filterRunning<T, U, R>(
  baseScenarios: BaseScenario<T, U, R>[]
): [BaseScenario<T, U, R>[], BaseScenario<T, U, R>[]] {
  let rest = baseScenarios.filter(({ scenario }) => scenario.flags === null);
  let only = baseScenarios.filter(({ scenario }) => scenario.flags === 'only');
  let skip = baseScenarios.filter(({ scenario }) => scenario.flags === 'skip');

  if (only.length > 0) {
    return [only, skip.concat(rest)];
  } else {
    return [rest, skip];
  }
}

function getBaseScenarios<T, U, R>(bases: ForkSpec[], scenarios: Scenario<T, U, R>[]): BaseScenario<T, U, R>[] {
  let result: BaseScenario<T, U, R>[] = [];

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
  return JSON.parse(JSON.stringify(object, (key, value) => typeof value === 'bigint' ? value.toString() : value ));
}

export async function runScenario<T, U, R>(
  scenarioConfig: ScenarioConfig,
  bases: ForkSpec[],
  workerCount: number,
  async: boolean,
  stallMs: number
) {
  let hardhatConfig = convertToSerializableObject(getConfig()) as HardhatConfig;
  let hardhatArguments = getHardhatArguments();
  let formats = defaultFormats;
  let scenarios: Scenario<T, U, R>[] = Object.values(await loadScenarios(scenarioGlob));
  let baseScenarios: BaseScenario<T, U, R>[] = getBaseScenarios(bases, scenarios);
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
  let assignable: Iterator<BaseScenario<T, U, R>> = runningScenarios[Symbol.iterator]();
  let done;
  let fail;
  let isDone = new Promise((resolve, reject) => {
    done = resolve;
    fail = reject;
  });

  let stallTimer;
  function resetStallTimer() {
    if (stallTimer !== undefined) {
      clearTimeout(stallTimer);
    }
    stallTimer = setTimeout(() => {
      fail(
        `Scenario stalled after ${stallMs} ms. Waiting scenario results for ${JSON.stringify(
          Array.from(pending)
        )}`
      );
    }, stallMs);
  }

  function checkDone() {
    if (pending.size === 0) {
      done();
    }
  }

  resetStallTimer();
  checkDone(); // Just in case we don't have any scens

  function getNextScenario(): BaseScenario<T, U, R> | null {
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
    pending.delete(key(result.base, result.scenario));
    // Update the scenario name to include the number of solution sets run and average gas cost.
    result.scenario += ` [${pluralize(result.numSolutionSets, 'run', 'runs')}]`;
    if (result.gasUsed) {
      result.scenario += ` [Avg gas: ${result.gasUsed}]`;
    }
    results.push(result);

    resetStallTimer();
    checkDone();
  }

  [...new Array(workerCount)].forEach((_, index) => {
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
    setTimeout(() => {
      // Deferral to allow potential console flush
      process.exit(1); // Exit as failure
    }, 0);
  }
}
