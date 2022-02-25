import fg from 'fast-glob';
import * as path from 'path';
import { Scenario, ScenarioFlags, Property, Initializer, Forker, Constraint } from './Scenario';

class Loader<T, U> {
  scenarios: { [name: string]: Scenario<T, U> };

  constructor() {
    this.scenarios = {};
  }

  addScenario(
    name: string,
    requirements: object,
    property: Property<T, U>,
    initializer: Initializer<T>,
    transformer: Transformer<T, U>,
    forker: Forker<T>,
    constraints: Constraint<T>[],
    flags: ScenarioFlags = null
  ) {
    if (this.scenarios[name]) {
      throw new Error(`Duplicate scenarios by name: ${name}`);
    }
    this.scenarios[name] = new Scenario<T, U>(
      name,
      requirements,
      property,
      initializer,
      transformer,
      forker,
      constraints,
      flags
    );
  }

  getScenarios(): { [name: string]: Scenario<T, U> } {
    return this.scenarios;
  }
}

let loader: any;

function setupLoader<T, U>() {
  if (loader) {
    throw new Error('Loader already initialized');
  }

  loader = new Loader<T, U>();
}

export function getLoader<T, U>(): Loader<T, U> {
  if (!loader) {
    throw new Error('Loader not initialized');
  }

  return <Loader<T, U>>loader;
}

export async function loadScenarios<T, U>(glob: string): Promise<{ [name: string]: Scenario<T, U> }> {
  setupLoader<T, U>();

  const entries = await fg(glob); // Grab all potential scenario files

  for (let entry of entries) {
    let entryPath = path.join(process.cwd(), entry);

    /* Import scenario file */
    await import(entryPath);
    /* Import complete */
  }

  return loader.getScenarios();
}
