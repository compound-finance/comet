import { World } from './World';
import { getStackFile } from './Stack';

// A solution modifies a given context and world in a way that satisfies a constraint.
export type Solution<T> = (T, World) => Promise<T | void>;

// XXX static and dynamic constraints diff types I guess
//  or can dynamic just have a constructor(requirements), same interface?

// A constraint is capable of producing solutions for a context and world *like* the ones provided.
// A constraint can also check a given context and world to see if they *actually* satisfy it.
// Note: `solve` and `check` are expected to treat the context and world as immutable.
export interface Constraint<T, R> {
  solve(
    requirements: R,
    context: T,
    world: World
  ): Promise<Solution<T> | Solution<T>[] | null>;
  check(requirements: R, context: T, world: World): Promise<void>;
}

export type Receipt = { cumulativeGasUsed: { toNumber: () => number } };
export type Property<T, U> = (properties: U, context: T, world: World) => Promise<Receipt | void>;
export type Initializer<T> = (world: World) => Promise<T>;
export type Transformer<T, U> = (context: T) => Promise<U>;

export interface ScenEnv<T, U, R> { // XXX drop R?
  constraints: Constraint<T, R>[]; // XXX drop R
  initializer: Initializer<T>;
  transformer: Transformer<T, U>;
}

export type ScenarioFlags = null | 'only' | 'skip';

export class Scenario<T, U, R> {
  name: string;
  file: string | null;
  constraints: Constraint<T, R>[]; // XXX drop R
  requirements: R;
  property: Property<T, U>;
  env: ScenEnv<T, U, R>; // XXX
  flags: ScenarioFlags;

  constructor(name, constraints, requirements, property, env, flags) {
    this.name = name;
    this.constraints = constraints;
    this.requirements = requirements;
    this.property = property;
    this.env = env;
    this.flags = flags;
    this.file = getStackFile();
  }
}
