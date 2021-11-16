import { Actor } from './Protocol'
import { Supposition } from './Suppose'

export default class Scenario {
  actors() {
    return {a: new Actor, b: new Actor}; // XXX
  }

  lib() {
    return {
      apr: x => x, // XXX
    }
  }

  suppose(sup: Supposition) {
    // XXX
    console.log('xxx suppose', sup)
  }

  timeTravel(xxx: any) {
    // XXX
    console.log('xxx time travel', xxx)
  }
}
