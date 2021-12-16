const path = require('path');
const { workerData } = require('worker_threads');
 
// Note: this is bootstrap code to run `worker.ts` from a worker thread that only knows nodejs at birth
require('ts-node').register();
let { run } = require(path.resolve(__dirname, './Worker.ts'));

run(workerData);
