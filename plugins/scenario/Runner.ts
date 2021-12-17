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
    const { config } = this;
    const {
      bases = [],
      constraints = [],
    } = config;

    for (const base of bases) {
      // construct a base world and context
      const world = new World(hreForBase(base));

      // freeze the world as it was before we run any scenarios
      await world._snapshot();

      for (const scenario of scenarios) {
        const context = await scenario.initializer(world, base);

        // generate worlds which satisfy the constraints
        // note: `solve` is expected not to modify context or world
        //  and constraints should be independent or conflicts will be detected
        const solutionChoices = await Promise.all(
          constraints.map(c => c.solve(scenario.requirements, context, world))
        );
        for (const combo of combos(solutionChoices)) {
          // create a fresh copy of context that solutions can modify
          let ctx = await scenario.forker(context);

          // apply each solution in the combo, then check they all still hold
          for (const solution of combo)
            ctx = await solution(ctx, world);
          for (const constraint of constraints)
            await constraint.check(scenario.requirements, ctx, world);

          // requirements met, run the property
          try {
            await scenario.property(ctx, world);
          } catch (e) {
            // XXX add scenario failure on ctx, world to report
          }

          // revert back to the frozen world for the next scenario
          await world._revert();
        }
      }
    }

    return this;
  }
}
