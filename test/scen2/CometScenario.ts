import {Constraint, Maybe, World, Scenario, Supposer} from './Scenario'

export class BalanceConstraint extends Constraint {
  static suppose<T extends Constraint>(supposition): T[] {
    return [<T>(new BalanceConstraint(supposition))];
  }

  apply(world: World): Maybe<World> {
    return world; // XXX
  }

  check(world): boolean {
    return true; // XXX
  }
}
