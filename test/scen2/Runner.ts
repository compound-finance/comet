import { Constraint, World, Scenario } from './Scenario'
import hreForBase from "./utils/hreForBase";

export type Address = string;
export type ForkSpec = {
  name: string;
  url: string;
  blockNumber?: number;
};

export type Deploy = (World) => Promise<void>;

export interface Config<T> {
  bases?: ForkSpec[];
  constraints?: Constraint<T>[];

  getInitialContext(world: World): Promise<T>;
}

function clone(context) {
  // XXX how do we deep clone those appropriately
  return Object.assign({}, context);
}

function *combos(choices: object[][]) {
  if (choices.length == 0) {
    yield [];
  } else {
    for (const option of choices[0])
      for (const combo of combos(choices.slice(1)))
        yield [option, ...combo];
  }
}
export class Runner<T> {
  config: Config<T>;

  constructor(config: Config<T>) {
    this.config = config;
  }

  async run(scenarios: Scenario<T>[]): Promise<Runner<T>> {
    const {
      bases = [],
      constraints = [],
    } = this.config;

    for (const base of bases) {
      // XXX read deployment for base
      //  should we *just* use an ethers instance?
      const world = new World(hreForBase(base));

      console.log('xxx world for base', base, world)

      const context = await this.config.getInitialContext(world) as T;

      // freeze the world as it was before we run any scenarios
      await world._snapshot();

      for (const scenario of scenarios) {
        let ctx = clone(context);

        // generate worlds which satisfy the constraints
        // note: `solve` is expected not to modify world, and constraints should be independent
        const solutionChoices = await Promise.all(
          constraints.map(c => c.solve(scenario.requirements, world))
        );
        for (const combo of combos(solutionChoices)) {
          for (const solution of combo)
            ctx = await solution(ctx, world);
          for (const constraint of constraints)
            await constraint.check(scenario.requirements, world);

          // XXX wrap in try/catch, add reporting
          // requirements met, run the property
          await scenario.property(ctx, world);

          // revert back to the frozen world for the next scenario
          await world._revert();
        }
      }
    }

    return this;
  }
}
