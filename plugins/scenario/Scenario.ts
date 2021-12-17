import { HardhatRuntimeEnvironment } from 'hardhat/types'

export class World {
  hre: HardhatRuntimeEnvironment;

  constructor(hre) {
    this.hre = hre;
  }

  async _snapshot() {
    // XXX
    // console.log('xxx snapshot')
  }

  async _revert() {
    // XXX
    // console.log('xxx revert')
  }
}

export interface Context {}
export interface ContextCreator<T extends Context> {
  initContext(world: World): Promise<T>;
  forkContext(context: T): Promise<T>;
}

// A solution modifies a given context and world in a way that satisfies a constraint.
export type Solution<T extends Context> = (T, World) => Promise<T>;

// A constraint is capable of producing solutions for a context and world *like* the ones provided.
// A constraint can also check a given context and world to see if they *actually* satisfy it.
// Note: `solve` and `check` are expected to treat the context and world as immutable.
export interface Constraint<T extends Context> {
  solve(requirements: object, context: T, world: World): Promise<Solution<T>[]>;
  check(requirements: object, context: T, world: World): Promise<void>;
}

export type Property<T extends Context> = (context: T, world: World) => Promise<any>;

export class Scenario<T extends Context> {
  name: string;
  requirements: object;
  property: Property<T>;

  constructor(name, requirements, property) {
    this.name = name;
    this.requirements = requirements;
    this.property = property;
  }
}
