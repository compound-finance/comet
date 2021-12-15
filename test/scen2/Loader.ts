import fg from 'fast-glob';
import * as path from 'path';
import { Scenario, Property } from './Scenario';

class Loader<T> {
  scenarios: { [name: string]: Scenario<T> };

  constructor() {
    this.scenarios = {};
  }

  addScenario(name: string, requirements: object, property: Property<T>) {
    if (this.scenarios[name]) {
      throw new Error(`Duplicate scenarios by name: ${name}`);
    }
    this.scenarios[name] = new Scenario<T>(name, requirements, property);
  }

  getScenarios(): { [name: string]: Scenario<T> } {
    return this.scenarios;
  }
}

let loader: any;

function setupLoader<T>() {
  if (loader) {
    throw new Error("Loader already initialized");
  }

  loader = new Loader<T>();
}

export function getLoader<T>(): Loader<T> {
  if (!loader) {
    throw new Error("Loader not initialized");
  }

  return <Loader<T>>loader;
}

export async function loadScenarios<T>(glob: string): Promise<{ [name: string]: Scenario<T> }> {
  setupLoader<T>();

  const entries = await fg(glob); // Grab all potential scenario files

  for (let entry of entries) {
    let entryPath = path.join(process.cwd(), entry);

    /* Import scenario file */
    await import(entryPath);
    /* Import complete */
  }

  return loader.getScenarios();
}
