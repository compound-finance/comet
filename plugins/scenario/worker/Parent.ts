import * as path from 'path';
import { Worker } from 'worker_threads';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { defaultFormats, scenarioGlob, workerCount } from './Config';
import { loadFormat, showReport, Format } from './Report';
import { getContext, getConfig, getHardhatArguments } from './HardhatContext';

export interface Result {
  scenario: string,
  elapsed?: number,
  error?: Error,
  trace?: string,
  skipped?: boolean
}

interface WorkerMessage {
  result?: Result
}

function filterRunning<T>(scenarios: Scenario<T>[]): [Scenario<T>[], Scenario<T>[]] {
  let rest = scenarios.filter((scenario) => scenario.flags === null);
  let only = scenarios.filter((scenario) => scenario.flags === "only");
  let skip = scenarios.filter((scenario) => scenario.flags === "skip");

  if (only.length > 0) {
    return [only, skip.concat(rest)];
  } else {
    return [rest, skip];
  }
}

export async function run<T>(taskArgs) {
  let hardhatConfig = getConfig();
  let hardhatArguments = getHardhatArguments();

  let formats = defaultFormats.map(loadFormat);
  let scenarios: Scenario<T>[] = Object.values(await loadScenarios(scenarioGlob));
  let [runningScenarios, skippedScenarios] = filterRunning(scenarios);

  let results: Result[] = skippedScenarios.map((scenario) => ({
    scenario: scenario.name,
    elapsed: undefined,
    error: undefined,
    skipped: true
  }));
  let pending: Set<string> = new Set(runningScenarios.map((scenario) => scenario.name));
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
      worker.postMessage({ scenario: scenario.name });
    }
  }

  function mergeResult(index: number, result: Result) {
    results.push(result);
    pending.delete(result.scenario);

    checkDone();
  }

  const worker = [...new Array(workerCount)].map((_, index) => {
    let worker = new Worker(path.resolve(__dirname, './BootstrapWorker.js'));

    worker.on('message', (message) => {
      if (message.result) {
        mergeResult(index, message.result);
        assignWork(worker);
      }
    });

    worker.postMessage({config: [hardhatConfig, hardhatArguments]});
    assignWork(worker);
  });

  await isDone;

  showReport(results, formats);

  if (results.some((result) => result.error)) {
    process.exit(1); // Exit as failure
  }
}
