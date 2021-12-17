import * as path from 'path';
import { Worker } from 'worker_threads';
import { Scenario } from '../Scenario';
import { loadScenarios } from '../Loader';
import { defaultFormats, scenarioGlob, workerCount } from './Config';
import { loadFormat, showReport, Format } from './Report';
import { getContext, getConfig, getHardhatArguments } from './HardhatContext';

export interface Result {
  scenario: string,
  elapsed: number,
  error?: Error
}

interface WorkerMessage {
  result?: Result
}

export async function run(taskArgs) {
  let hardhatConfig = getConfig();
  let hardhatArguments = getHardhatArguments();
  // console.log({hardhatConfig});

  let formats = defaultFormats.map(loadFormat);
  let scenarios: string[] = Object.values(await loadScenarios(scenarioGlob)).map((scenario) => scenario.name);

  let results: Result[] = [];
  let pending: Set<string> = new Set(scenarios);
  let assignable: Iterator<string> = scenarios[Symbol.iterator]();
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

  function assignWork(worker: Worker) {
    let next = assignable.next();
    if (!next.done && next.value) {
      worker.postMessage({ scenario: next.value });
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
