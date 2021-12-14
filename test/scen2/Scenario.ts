import { HardhatRuntimeEnvironment } from 'hardhat/types'

export class World {
  hre: HardhatRuntimeEnvironment;

  async _snapshot() {
    // XXX
    console.log('xxx snapshot')
  }

  async _revert() {
    // XXX
    console.log('xxx revert')
  }
}

export type Solution<T> = (T, World) => Promise<T>;

export interface Constraint<T> {
  solve(requirements: object, world: World): Promise<Solution<T>[]>;
  check(requirements: object, world: World): Promise<void>;
}

export type Property<T> = (context: T, world: World) => Promise<any>;

export class Scenario<T> {
  description: string;
  requirements: object;
  property: Property<T>;
}
