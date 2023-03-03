import { World } from './World';
import { getStackFile } from './Stack';

// A solution modifies a given context and world in a way that satisfies a constraint.
export type Solution<T> = (T, World) => Promise<T | void>;
export type Solutions<T> = Solution<T> | Solution<T>[] | null;

// A constraint is capable of producing solutions for a world which satisfy it.
// A constraint can also check a given world to see if it *actually* satisfies.

export interface StaticConstraint<T> {
  solve(world: World): Promise<Solutions<T>>;
  check(world: World): Promise<void>;
}

export interface DynamicConstraint<T, R> {
  solve(requirements: R, context: T, world: World): Promise<Solutions<T>>;
  check(requirements: R, context: T, world: World): Promise<void>;
}

export type { DynamicConstraint as Constraint };

export type Receipt = { cumulativeGasUsed: { toNumber: () => number } };
export type Property<T, U> = (properties: U, context: T, world: World) => Promise<Receipt | void>;
export type Initializer<T> = (world: World) => Promise<T>;
export type Transformer<T, U> = (context: T) => Promise<U>;

export interface ScenarioEnv<T, U> {
  constraints: StaticConstraint<T>[];
  initializer: Initializer<T>;
  transformer: Transformer<T, U>;
}

export type ScenarioFlags = null | 'only' | 'skip';

export class Scenario<T, U, R> {
  name: string;
  file: string | null;
  constraints: DynamicConstraint<T, R>[];
  requirements: R;
  property: Property<T, U>;
  env: ScenarioEnv<T, U>;
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
