import { HardhatRuntimeEnvironment } from 'hardhat/types'

export type Maybe<T> = T | null;

export interface World {
  hre: HardhatRuntimeEnvironment,
}

export interface Context {
  world: World
}

export interface Supposer {
  suppose<T extends Constraint>(supposition): T[];
}

export abstract class Constraint {
  supposition: any;

  constructor(supposition) {
    this.supposition = supposition;
  }

  abstract apply(world: World): Maybe<World>;
  abstract check(world: World): boolean;
}

export class Scenario {

}
