import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { Constraint, Context, Maybe, World, Scenario, Supposer } from './Scenario'

export type Address = string;
export type ForkSpec = string;

export type Partial = Context;
export type Deploy = (World, Partial) => void;

export interface Actor {
  address: Address;
}

export interface Config {
  bases?: ForkSpec[];
  actors?: {[name: string]: { new(): Actor }};
  contracts?: {[name: string]: Deploy };
  supposers?: Supposer[];
}

export class Runner {
  config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async run(hre: HardhatRuntimeEnvironment): Promise<Runner> {
    const {
      bases = [],
      actors = {},
      contracts = {},
      supposers = [],
    } = this.config;

    // XXX prepare constraint paths
    for (const supposer of supposers) {
      const constraints = supposer.suppose({some: 'supposition'})
      console.log('xxx constraints', constraints)
    }

    // XXX construct contexts
    for (const base of bases) {
      console.log('xxx base', base)

      // XXX load fork for base
      // XXX read deployment for base
      // XXX can we actually construct new hres for each?
      // XXX apply each path, check
      for (const [name, actor] of Object.entries(actors)) {
        console.log('xxx actor', actor)
      }

      for (const [name, contract] of Object.entries(contracts)) {
        console.log('xxx contract', contract)
      }
    }

    return this;
  }
}
