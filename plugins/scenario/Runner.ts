import { Constraint, Scenario, Solution } from './Scenario';
import { ForkSpec, World } from './World';
import hreForBase from './utils/hreForBase';

export type Address = string;

export type ResultFn<T> = (base: ForkSpec, scenario: Scenario<T>, err?: any) => void;

export interface Config<T> {
  bases?: ForkSpec[];
}

function* combos(choices: object[][]) {
  if (choices.length == 0) {
    yield [];
  } else {
    for (const option of choices[0])
      for (const combo of combos(choices.slice(1))) yield [option, ...combo];
  }
}

function bindFunctions(obj: any) {
  for (let property of Object.getOwnPropertyNames(Object.getPrototypeOf(obj))) {
    if (typeof(obj[property]) === 'function') {
      obj[property] = obj[property].bind(obj);
    }
  }
}

async function identity<T>(ctx: T, world: World): Promise<T> {
  return ctx;
}

function asList<T>(v: T | T[]): T[] {
  return [].concat(v);
}

function mapSolution<T>(s: Solution<T> | Solution<T>[] | null): Solution<T>[] {
  if (s == null) {
    return [identity];
  } else {
    return asList(s);
  }
}

export class Runner<T> {
  config: Config<T>;

  constructor(config: Config<T>) {
    this.config = config;
  }

  async run(scenarios: Scenario<T>[], resultFn: ResultFn<T>): Promise<Runner<T>> {
    const { config } = this;
    const { bases = [] } = config;

    for (const base of bases) {
      // construct a base world and context
      const world = new World(hreForBase(base), base); // XXX can cache/re-use HREs per base

      // freeze the world as it was before we run any scenarios
      let snapshot = await world._snapshot();

      for (const scenario of scenarios) {
        const { constraints = [] } = scenario;
        const context = await scenario.initializer(world);

        // generate worlds which satisfy the constraints
        // note: `solve` is expected not to modify context or world
        //  and constraints should be independent or conflicts will be detected
        const solutionChoices: Solution<T>[][] = await Promise.all(
          constraints.map((c) => c.solve(scenario.requirements, context, world).then(mapSolution))
        );
        const baseSolutions: Solution<T>[][] = [[identity]];

        for (const combo of combos(baseSolutions.concat(solutionChoices))) {
          // create a fresh copy of context that solutions can modify
          let ctx = await scenario.forker(context);

          // apply each solution in the combo, then check they all still hold
          for (const solution of combo) {
            ctx = (await solution(ctx, world)) || ctx;
          }

          for (const constraint of constraints) {
            await constraint.check(scenario.requirements, ctx, world);
          }

          // bind all functions on object
          bindFunctions(ctx);

          // requirements met, run the property
          try {
            await scenario.property(ctx, world);
            resultFn(base, scenario);
          } catch (e) {
            resultFn(base, scenario, e);
          }

          // revert back to the frozen world for the next scenario
          await world._revert(snapshot);

          // snapshots can only be used once, so take another for next time
          snapshot = await world._snapshot();
        }
      }
    }

    return this;
  }
}
