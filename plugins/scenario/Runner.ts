import { Constraint, Scenario, Solution } from './Scenario';
import { ForkSpec, World } from './World';
import hreForBase from './utils/hreForBase';
import { CometContext } from '../../scenario/context/CometContext';

export type Address = string;

export type ResultFn<T> = (base: ForkSpec, scenario: Scenario<T>, err?: any) => void;

export interface Config<T> {
  base: ForkSpec;
  world: World;
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
  worldSnapshot: string;

  constructor(config: Config<T>) {
    this.config = config;
  }

  async run(scenario: Scenario<T>, resultFn: ResultFn<T>): Promise<Runner<T>> {
    const { config } = this;
    const { base, world } = config;
    const { constraints = [] } = scenario;

    // reset the world if a snapshot exists and take a snapshot of it
    if (this.worldSnapshot) {
      await world._revert(this.worldSnapshot);
    }
    this.worldSnapshot = (await world._snapshot()) as string;

    // initialize the context and take a snapshot of it
    let context = await scenario.initializer(world);
    let contextSnapshot = await world._snapshot();

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
      } catch (e) {
        // TODO: Include the specific solution (set of states) that failed in the result
        resultFn(base, scenario, e);
      }

      // revert back to the frozen world for the next scenario
      await world._revert(contextSnapshot);

      // snapshots can only be used once, so take another for next time
      contextSnapshot = await world._snapshot();
    }
    // Send success result only after all combinations of solutions have passed for this scenario.
    resultFn(base, scenario);

    return this;
  }
}
