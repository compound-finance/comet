import {Constraint, Scenario, Solution, World} from './Scenario'

export class BalanceConstraint<T> implements Constraint<T> {
  async solve(requirements: object, world: World) {
    return [async (ctx: T, world: World) => ctx]; // XXX
  }

  async check(requirements: object, world) {
    return; // XXX
  }
}
