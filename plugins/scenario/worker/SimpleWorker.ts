import { run, WorkerData } from './Worker';

export type Handler = (any) => Promise<void>;

export class SimpleWorker {
  workerData: WorkerData;
  childMessages: any[];
  parentMessages: any[];
  childHandlers: Handler[];
  parentHandlers: Handler[];

  constructor(workerData: WorkerData) {
    this.workerData = workerData;
    this.childMessages = [];
    this.parentMessages = [];
    this.childHandlers = [];
    this.parentHandlers = [];
  }

  // Register to child messages
  on(msg: 'message', f: (message: any) => Promise<void>) {
    this.parentHandlers.push(f);

    this.parentMessages.forEach((msg) => f(msg));
    this.parentMessages = []; // Clear out messages
  }

  // Post message to child
  postMessage(message: any) {
    if (this.childHandlers.length > 0) {
      this.childHandlers.forEach((f) => f(message));
    } else {
      this.childMessages.push(message); // store if no handlers
    }
  }

  // Register to parent messages
  onParent(msg: 'message', f: (message: any) => Promise<void>) {
    this.childHandlers.push(f);

    this.childMessages.forEach((msg) => f(msg));
    this.childMessages = []; // Clear out messages
  }

  // Post message to parent
  postParentMessage(message: any) {
    this.parentHandlers.forEach((f) => f(message));
  }

  async run() {
    try {
      await run({ ...this.workerData, worker: this });
    } catch (e) {
      console.error(e);
      setTimeout(() => { // Deferral to allow potential console flush
        throw e;
      }, 0);
    }
  }
}
