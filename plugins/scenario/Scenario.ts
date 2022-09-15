import { World } from './World';
import { getStack } from './Stack';

// A solution modifies a given context and world in a way that satisfies a constraint.
export type Solution<T> = (T, World) => Promise<T | void>;

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
export type Forker<T> = (T, world: World) => Promise<T>;

export type ScenarioFlags = null | 'only' | 'skip';

export class Scenario<T, U, R> {
  name: string;
  file: string | null;
  requirements: R;
  property: Property<T, U>;
  initializer: Initializer<T>;
  transformer: Transformer<T, U>;
  forker: Forker<T>;
  constraints: Constraint<T, R>[];
  flags: ScenarioFlags;

  constructor(name, requirements, property, initializer, transformer, forker, constraints, flags) {
    this.name = name;
    this.requirements = requirements;
    this.property = property;
    this.initializer = initializer;
    this.transformer = transformer;
    this.forker = forker;
    this.constraints = constraints;
    this.flags = flags;
    let frame = getStack(3);
    this.file = frame[0] ? frame[0].file : null;
  }
}
