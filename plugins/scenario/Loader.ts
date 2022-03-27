import fg from 'fast-glob';
import * as path from 'path';
import { Scenario, ScenarioFlags, Property, Initializer, Forker, Constraint, Transformer } from './Scenario';

class Loader<T, U, R> {
  scenarios: { [name: string]: Scenario<T, U, R> };

  constructor() {
    this.scenarios = {};
  }

  addScenario(
    name: string,
    requirements: R,
    property: Property<T, U>,
    initializer: Initializer<T>,
    transformer: Transformer<T, U>,
    forker: Forker<T>,
    constraints: Constraint<T, R>[],
    flags: ScenarioFlags = null
  ) {
    if (this.scenarios[name]) {
      throw new Error(`Duplicate scenarios by name: ${name}`);
    }
    this.scenarios[name] = new Scenario<T, U, R>(
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

  getScenarios(): { [name: string]: Scenario<T, U, R> } {
    return this.scenarios;
  }
}

let loader: any;

function setupLoader<T, U, R>() {
  if (loader) {
    throw new Error('Loader already initialized');
  }

  loader = new Loader<T, U, R>();
}

export function getLoader<T, U, R>(): Loader<T, U, R> {
  if (!loader) {
    throw new Error('Loader not initialized');
  }

  return <Loader<T, U, R>>loader;
}

export async function loadScenarios<T, U, R>(glob: string): Promise<{ [name: string]: Scenario<T, U, R> }> {
  setupLoader<T, U, R>();

  const entries = await fg(glob); // Grab all potential scenario files

  for (let entry of entries) {
    let entryPath = path.join(process.cwd(), entry);

    /* Import scenario file */
    await import(entryPath);
    /* Import complete */
  }

  return loader.getScenarios();
}
