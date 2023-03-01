import fg from 'fast-glob';
import * as path from 'path';
import {
  Scenario,
  ScenarioEnv,
  ScenarioFlags,
  Property,
  Initializer,
  StaticConstraint,
  DynamicConstraint,
  Transformer
} from './Scenario';

export interface ScenarioBuilder<T, U, R> {
  (name: string, requirements: R, property: Property<T, U>): void;
  only: (name: string, requirements: R, property: Property<T, U>) => void;
  skip: (name: string, requirements: R, property: Property<T, U>) => void;
}

export class Loader<T, U, R> {
  scenarios: { [name: string]: Scenario<T, U, R> };
  constraints?: StaticConstraint<T>[];
  initializer?: Initializer<T>;
  transformer?: Transformer<T, U>;

  static instance: any;

  static get<T, U, R>(): Loader<T, U, R> {
    if (!this.instance)
      throw new Error('Loader not initialized');
    return this.instance;
  }

  static async load<T, U, R>(glob = 'scenario/**.ts'): Promise<Loader<T, U, R>> {
    if (this.instance)
      throw new Error('Loader already initialized');
    return await (this.instance = new Loader() as Loader<T, U, R>).load(glob);
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
    constraints: StaticConstraint<T>[],
    initializer: Initializer<T>,
    transformer: Transformer<T, U>,
  ): this {
    this.constraints = constraints;
    this.initializer = initializer;
    this.transformer = transformer;
    return this;
  }

  env(): ScenarioEnv<T, U> {
    if (!this.constraints || !this.initializer || !this.transformer)
      throw new Error('Loader not configured');
    return this as ScenarioEnv<T, U>;
  }

  scenarioFun(
    constraints: DynamicConstraint<T, R>[]
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
    constraints: DynamicConstraint<T, R>[],
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
      this.env(),
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
