import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { expect } from 'chai'

import Scenario from './Scenario'

type ScenClass = new (...args: any[]) => Scenario

export default class Runner {
  scenTypes: ScenClass[];

  constructor(scenTypes: ScenClass[]) {
    this.scenTypes = scenTypes;
  }

  run(hre: HardhatRuntimeEnvironment): Runner {
    for (const scenType of this.scenTypes) {
      describe(scenType.name, () => {
        const scen = new scenType();
        const actors = scen.actors();
        for (const name of Object.getOwnPropertyNames(scenType.prototype)) {
          if (name.startsWith('test')) {
            it(name, async () => {
              await scen[name](actors);
            })
          }
        }
      })
    }
    return this;
  }
}
