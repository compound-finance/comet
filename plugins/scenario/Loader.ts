import fg from 'fast-glob';
import * as path from 'path';
import { Scenario, ScenarioFlags, Property, Initializer, Constraint, Transformer } from './Scenario';

export interface ScenarioBuilder<T, U, R> {
  (name: string, requirements: R, property: Property<T, U>): void;
  only: (name: string, requirements: R, property: Property<T, U>) => void;
  skip: (name: string, requirements: R, property: Property<T, U>) => void;
}

let loader: any; // XXX move to cls?

export class Loader<T, U, R> {
  scenarios: { [name: string]: Scenario<T, U, R> };
  constraints?: Constraint<T, U>[]; // XXX StaticConstraint<T, U>?
  initializer?: Initializer<T>;
  transformer?: Transformer<T, U>;

  static get(): Loader<any, any, any> { // XXX
    if (!loader)
      throw new Error('Loader not initialized');
    return loader;
  }

  static async load(glob = 'scenario/**.ts'): Promise<Loader<any, any, any>> { // XXX
    if (loader)
      throw new Error('Loader already initialized');
    return await (loader = new Loader()).load(glob);
  }

  async load(glob = 'scenario/**.ts'): Promise<this> {
    for (let entry of await fg(glob))
      await import(path.join(process.cwd(), entry));
    return this;
  }

  constructor() {
    this.scenarios = {};
  }

  configure(
    constraints: Constraint<T, U>[], // XXX StaticConstraint<T, U>?
    initializer: Initializer<T>,
    transformer: Transformer<T, U>,
  ): this {
    this.constraints = constraints;
    this.initializer = initializer;
    this.transformer = transformer;
    return this; // XXX
  }

  scenarioFun(
    constraints: Constraint<T, R>[] // XXX dynamic constriants?
  ): ScenarioBuilder<T, U, R> {
    const addScenarioWithOpts =
      (flags: ScenarioFlags) => (name: string, requirements: R, property: Property<T, U>) => {
        this.addScenario(name, constraints, requirements, property, flags);
      };
    return Object.assign(addScenarioWithOpts(null), {
      only: addScenarioWithOpts('only'),
      skip: addScenarioWithOpts('skip'),
    });
  }

  addScenario(
    name: string,
    constraints: Constraint<T, R>[],
    requirements: R,
    property: Property<T, U>,
    flags: ScenarioFlags = null
  ) {
    if (this.scenarios[name])
      throw new Error(`Duplicate scenarios by name: ${name}`);
    this.scenarios[name] = new Scenario<T, U, R>(
      name,
      constraints,
      requirements,
      property,
      this,
      flags
    );
  }

  splitScenarios(): [Scenario<T, U, R>[], Scenario<T, U, R>[]] {
    const scenarios = Object.values(this.scenarios);
    const rest = scenarios.filter(s => s.flags === null);
    const only = scenarios.filter(s => s.flags === 'only');
    const skip = scenarios.filter(s => s.flags === 'skip');
    if (only.length > 0) {
      return [only, skip.concat(rest)];
    } else {
      return [rest, skip];
    }
  }
}
